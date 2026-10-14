import { db, DB_ID, isConflict, isNotFound } from "./client.ts";
import { ENV } from "./env.ts";
import { totalsRowId } from "./ids.ts";
import { authenticateDevice, issueLinkCode, redeemLinkCode, touchDevice } from "./repo/devices.ts";
import {
  HANDLE_CHANGE_LIMIT,
  HANDLE_RE,
  findProfileByHandle,
  findProfileById,
  handleChangesLeft,
  toPublicUser,
  type Profile,
  type PublicUser,
} from "./repo/profiles.ts";
import { refreshTotals, rankOf, getTotals } from "./repo/leaderboard.ts";
import { assess } from "./repo/integrity.ts";
import { listUsage, normalizeRow, summarize, upsertUsage, type SyncRow } from "./repo/usage.ts";
import {
  MAX_AGENT_ENTRIES,
  normalizeAgents,
  upsertAgents,
  type AgentRejection,
} from "./repo/agents.ts";
import { deviceMayUpload, isOAuthDevice, versionAfterSync } from "./oauth/devices.ts";

/**
 * The operations behind each API route.
 *
 * Route handlers stay thin — parse, call one of these, serialise. Keeping the
 * logic here means the Next.js app and an Appwrite Function can expose the same
 * behaviour without duplicating it.
 */

/** Refuse absurd uploads outright rather than trying to store them. */
const MIN_SYNC_INTERVAL_MS = 10_000;
const MAX_ROWS = 20_000;

export type ServiceError = { status: number; error: string; hint?: string };

const fail = (status: number, error: string, hint?: string): ServiceError => ({
  status,
  error,
  hint,
});

/* ------------------------------------------------------- POST /api/cli/link */

export interface LinkRequest {
  code?: unknown;
  device?: { hostname?: unknown; platform?: unknown; cliVersion?: unknown };
}

export async function cliLink(
  body: LinkRequest,
): Promise<{ token: string; user: PublicUser } | ServiceError> {
  const raw = typeof body.code === "string" ? body.code : "";
  // Accept any case, with or without the dash — people paste these.
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length !== 8) return fail(400, "that code is not valid");

  const code = `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.length > 0 ? v.slice(0, max) : undefined;

  const result = await redeemLinkCode(code, {
    hostname: str(body.device?.hostname, 128),
    platform: str(body.device?.platform, 32),
    cliVersion: str(body.device?.cliVersion, 32),
  });

  if (!result.ok) {
    if (result.reason === "expired") {
      return fail(404, "that code has expired", "Generate a fresh code on your dashboard.");
    }
    if (result.reason === "used") {
      return fail(404, "that code was already used", "Generate a fresh code on your dashboard.");
    }
    return fail(404, "that code has expired or was already used");
  }

  return { token: result.token, user: toPublicUser(result.profile) };
}

/* -------------------------------------------------- POST /api/cli/link-code */

/**
 * A link code asked for by an app that is already signed in, for the tokn
 * command on the same machine: Eaon Desktop ships tokn and links it with
 * this, so nobody signs in twice. The code is the same short-lived,
 * single-use kind the /link page shows, redeemed by `tokn link --code`.
 *
 * Only an app sign-in that may upload usage can ask. A CLI token can do no
 * more than that (upload and read), so the token the code leads to gives the
 * app nothing it didn't already have; a read-only app sign-in can't climb
 * to an uploading one this way.
 */
export async function cliLinkCode(
  authorization: string | null,
): Promise<{ code: string; expiresAt: string } | ServiceError> {
  const auth = await authenticateDevice(authorization);
  if (!auth) return unlinked();
  const id = auth.device.$id;
  if (!isOAuthDevice(id) || !deviceMayUpload(id)) {
    return fail(403, "only an app signed in with usage:write can link another program");
  }
  return issueLinkCode(auth.profile.$id);
}

/* --------------------------------------------------------- GET /api/cli/me */

export async function cliMe(
  authorization: string | null,
): Promise<{ user: PublicUser } | ServiceError> {
  const auth = await authenticateDevice(authorization);
  if (!auth) return unlinked();
  return { user: toPublicUser(auth.profile) };
}

const unlinked = (): ServiceError =>
  fail(401, "this machine is no longer linked", "Run `tokn link` to reconnect.");

/* ------------------------------------------------------- POST /api/cli/sync */

export interface SyncRequest {
  rows?: unknown;
  /**
   * Agent runs per day, from apps that have them (Eaon Desktop). Optional:
   * the CLI never sends it, and an upload without it leaves stored runs alone.
   * `[{ day, tool, runs, totalMs, longestMs }]` — see repo/agents.ts.
   */
  agents?: unknown;
  timezone?: unknown;
  scannedAt?: unknown;
  cliVersion?: unknown;
}

export interface SyncResult {
  accepted: number;
  skipped: number;
  rank?: number;
  profileUrl: string;
  /**
   * Rows the server would not store, with the reason.
   *
   * Reported rather than silently dropped: an honest user whose total does not
   * match their machine needs to be able to find out why, and a dishonest one
   * learning which rule caught them costs nothing — the rules are published in
   * the source anyway, and security that depends on them being secret is not
   * security.
   */
  rejected?: { day: string; model: string; reason: string; detail: string }[];
  /** Present when the upload carried `agents`. */
  agents?: { accepted: number; rejected?: AgentRejection[] };
  /**
   * The person's page on the Eaon Desktop board, once they have any Eaon
   * usage. Absent otherwise, so the app can tell "not yet" from a link.
   */
  eaonProfileUrl?: string;
}

/**
 * Store one scan.
 *
 * The CLI re-uploads its whole history every run, so this **replaces** rows
 * rather than adding to them — see `repo/usage.ts`. Malformed rows are dropped
 * individually and counted in `skipped`; one bad line should not cost someone
 * their entire scan.
 */
export async function cliSync(
  authorization: string | null,
  body: SyncRequest,
  options: {
    /**
     * Where to look up the rank the CLI prints. Defaults to the live rollup.
     * The website passes its own board, which refreshes hourly, so the rank a
     * sync reports is the one people can actually see.
     */
    rankOf?: (userId: string) => Promise<number | null>;
  } = {},
): Promise<SyncResult | ServiceError> {
  const auth = await authenticateDevice(authorization);
  if (!auth) return unlinked();

  // An app signed in through OAuth uploads only if the person allowed it to.
  // Every CLI device may. See oauth/devices.ts for where that is recorded.
  if (!deviceMayUpload(auth.device.$id)) {
    return fail(403, "this app was not given permission to upload usage", "Sign in again and allow uploads.");
  }

  /**
   * A floor on how often one device may sync.
   *
   * This protects the server, not the leaderboard — worth being clear about,
   * because a throttle is easy to mistake for anti-cheat. Syncs are upserts
   * keyed on (user, day, tool, model), so replaying one a thousand times
   * changes no total; it just costs us the writes. What it stops is a loop
   * hammering the endpoint. Ten seconds is under any real cadence: autosync
   * runs on a 90-minute timer, and the session hook holds a local lock.
   */
  const since = auth.device.lastSyncAt
    ? Date.now() - Date.parse(auth.device.lastSyncAt)
    : Infinity;
  if (Number.isFinite(since) && since < MIN_SYNC_INTERVAL_MS) {
    return fail(429, "syncing too often — wait a moment and try again");
  }

  if (!Array.isArray(body.rows)) return fail(400, "rows must be an array");
  if (body.rows.length > MAX_ROWS) {
    return fail(400, `too many rows in one request (max ${MAX_ROWS})`);
  }
  if (body.agents !== undefined && body.agents !== null) {
    if (!Array.isArray(body.agents)) return fail(400, "agents must be an array");
    if (body.agents.length > MAX_AGENT_ENTRIES) {
      return fail(400, `too many agent entries in one request (max ${MAX_AGENT_ENTRIES})`);
    }
  }

  const normalized: SyncRow[] = [];
  for (const candidate of body.rows) {
    const row = normalizeRow(candidate);
    if (row) normalized.push(row);
  }

  // Shape first, then plausibility and pricing. `assess` replaces every
  // costUsd with the server's own figure, so nothing the client claimed about
  // money survives this line.
  const checked = await assess(normalized);
  if (checked.overSyncLimit) {
    return fail(413, "that upload claims more tokens than a machine could produce");
  }

  if (checked.rejected.length > 0) {
    console.warn(
      `[sync] rejected ${checked.rejected.length} row(s) from ${auth.profile.handle} ` +
        `(device ${auth.device.$id}): ` +
        checked.rejected.map((r) => `${r.reason}:${r.detail}`).join("; "),
    );
  }

  const rows = checked.rows;
  await upsertUsage(auth.profile.$id, rows);

  const agents = Array.isArray(body.agents) ? await storeAgents(auth.profile.$id, body.agents) : undefined;

  const cliVersion = typeof body.cliVersion === "string" ? body.cliVersion : undefined;
  // An app's row keeps its `<client_id>/` prefix, or the account page would
  // stop knowing which app it is after the first sync.
  await touchDevice(auth.device.$id, versionAfterSync(auth.device, cliVersion));

  // The rollup is what the leaderboard reads, so it has to be refreshed before
  // we can report a rank.
  const summary = await refreshTotals(auth.profile.$id);
  const rank = await (options.rankOf ?? ((userId: string) => rankOf(userId)))(auth.profile.$id);
  const hasEaon = summary.byTool.some((entry) => entry.tool === EAON_TOOL);

  return {
    accepted: rows.length,
    skipped: body.rows.length - rows.length,
    rejected: checked.rejected.length > 0 ? checked.rejected : undefined,
    rank: rank ?? undefined,
    // Must match the app's route, which is /profile/[handle]. The CLI prints
    // this link, so a mismatch hands the user a 404.
    profileUrl: `${ENV.publicUrl.replace(/\/+$/, "")}/profile/${auth.profile.handle}`,
    agents,
    eaonProfileUrl: hasEaon ? eaonProfileUrl(auth.profile.handle) : undefined,
  };
}

/** The usage `tool` Eaon Desktop reports under. */
export const EAON_TOOL = "eaon";

/** `https://tokns.eaon.dev/@ada` — the short form the Eaon host serves. */
export function eaonProfileUrl(handle: string): string {
  return `${ENV.eaonUrl.replace(/\/+$/, "")}/@${handle}`;
}

/**
 * Agent runs are a side table, and losing them must not cost the upload.
 *
 * The usage rows are already stored by the time this runs. If `agent_daily`
 * is not provisioned yet, or a write fails, the sync still succeeds and says
 * nothing was accepted; the app re-sends its whole history next time, which
 * heals the gap.
 */
async function storeAgents(
  userId: string,
  list: unknown[],
): Promise<{ accepted: number; rejected?: AgentRejection[] }> {
  const { rows, rejected } = normalizeAgents(list);
  try {
    const accepted = await upsertAgents(userId, rows);
    return { accepted, rejected: rejected.length > 0 ? rejected : undefined };
  } catch (error) {
    console.error(`[sync] could not store agent runs for ${userId}:`, error);
    return { accepted: 0, rejected: rejected.length > 0 ? rejected : undefined };
  }
}

/* ------------------------------------------------------------- profile data */

export interface ProfilePayload {
  user: PublicUser;
  totals: Awaited<ReturnType<typeof getTotals>>;
  summary: ReturnType<typeof summarize>;
  rank: number | null;
}

/** Everything a public profile page renders. */
export async function profilePayload(profile: Profile): Promise<ProfilePayload> {
  const rows = await listUsage(profile.$id);
  return {
    user: toPublicUser(profile),
    totals: await getTotals(profile.$id),
    summary: summarize(rows),
    rank: await rankOf(profile.$id),
  };
}

/* ------------------------------------------------------------- rename */

export type RenameResult =
  | { ok: true; profile: Profile; changesLeft: number }
  | { ok: false; error: string; hint?: string };

/**
 * Change a handle, within the lifetime cap.
 *
 * The handle is denormalised onto `user_totals` so the leaderboard can be read
 * without joining, which means a rename has to touch two rows. The profile is
 * written first: if the totals update then fails, the board shows a stale name
 * until the next sync rather than the profile and the board disagreeing about
 * who owns the handle.
 *
 * Case-only edits (`ada` to `Ada`) are free — they do not move the URL, so
 * they do not spend one of the two changes.
 */
export async function changeHandle(userId: string, requested: string): Promise<RenameResult> {
  const handle = requested.trim();

  if (!HANDLE_RE.test(handle)) {
    return {
      ok: false,
      error: "handles are 2-24 characters: letters, digits, _ . -",
    };
  }

  const profile = await findProfileById(userId);
  if (!profile) return { ok: false, error: "no such account" };

  if (profile.handle === handle) {
    return { ok: true, profile, changesLeft: handleChangesLeft(profile) };
  }

  const lower = handle.toLowerCase();
  const renaming = lower !== profile.handleLower;

  if (renaming && handleChangesLeft(profile) <= 0) {
    return {
      ok: false,
      error: `a handle can be changed ${HANDLE_CHANGE_LIMIT} times`,
      hint: "contact support if you need another change",
    };
  }

  if (renaming) {
    const taken = await findProfileByHandle(handle);
    if (taken) return { ok: false, error: "that handle is taken" };
  }

  let updated: Profile;
  try {
    updated = (await db().updateDocument(DB_ID, "profiles", userId, {
      handle,
      handleLower: lower,
      // A case-only edit is not a change, so it does not spend one.
      handleChanges: (profile.handleChanges ?? 0) + (renaming ? 1 : 0),
    })) as unknown as Profile;
  } catch (error) {
    // The unique index is what actually decides a race between two people
    // claiming the same handle at once.
    if (isConflict(error)) return { ok: false, error: "that handle is taken" };
    throw error;
  }

  try {
    await db().updateDocument(DB_ID, "user_totals", totalsRowId(userId), {
      handle,
      handleLower: lower,
    });
  } catch (error) {
    // No totals row yet simply means this account has never synced.
    if (!isNotFound(error)) throw error;
  }

  return { ok: true, profile: updated, changesLeft: handleChangesLeft(updated) };
}
