import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { profilesChanged } from "./board-cache";
import {
  authenticate as backendAuthenticate,
  authenticateDevice as backendAuthenticateDevice,
  changeHandle as backendChangeHandle,
  createProfile,
  createSession as backendCreateSession,
  deleteSession as backendDeleteSession,
  findProfileByHandle,
  findProfileById,
  handleChangesLeft,
  listedFor,
  HANDLE_CHANGE_LIMIT,
  issueLinkCode as backendIssueLinkCode,
  listDevices as backendListDevices,
  readLinkCode as backendReadLinkCode,
  redeemLinkCode as backendRedeemLinkCode,
  resolveSession,
  revokeDevice as backendRevokeDevice,
  updateProfile,
  HandleTakenError,
  hashPassword,
  hashToken,
  verifyPassword,
  type Device,
  type LinkCode as BackendLinkCode,
  type Profile,
} from "./backend";
import { fixtureProfile, fixturesOn } from "./fixtures";

/**
 * Accounts, browser sessions and CLI device tokens — backed by Appwrite.
 *
 * The exported names and the *row shapes* match the SQLite layer this replaced,
 * so pages and routes keep reading `user.id`, `device.last_sync_at` and so on.
 * Appwrite's camelCase and `$id` are mapped back here, at the boundary, rather
 * than rippling snake_case renames through every component.
 *
 * The one thing callers must change: everything is now async.
 *
 * Two credentials live here and they are deliberately different things:
 *
 *   session cookie — a browser, expires in 30 days, stored as a plain id
 *   device token   — a machine running `tokn`, long-lived, stored only as a
 *                    SHA-256 hash so a leaked database cannot sync as anyone
 */

const SESSION_COOKIE = "tokn_session";

export { hashPassword, verifyPassword, hashToken, HandleTakenError };

export const HANDLE_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{1,23}$/;

export { HANDLE_CHANGE_LIMIT };

/**
 * Change the signed-in user's handle, within the lifetime cap.
 *
 * Returns a result rather than throwing: every failure here is something the
 * person can act on, so the settings form shows the reason inline.
 */
export async function changeHandle(
  userId: string,
  handle: string,
): Promise<{ ok: true; handle: string; changesLeft: number } | { ok: false; error: string }> {
  const result = await backendChangeHandle(userId, handle);
  if (result.ok) profilesChanged();

  return result.ok
    ? { ok: true, handle: result.profile.handle, changesLeft: result.changesLeft }
    : { ok: false, error: result.hint ? `${result.error} — ${result.hint}` : result.error };
}

/* ------------------------------------------------------------ row shapes */

/** Mirrors the old SQLite `users` row so callers need no edits. */
export interface UserRow {
  id: string;
  handle: string;
  handle_lower: string;
  name: string | null;
  bio: string | null;
  created_at: string;
  billing: string;
  links: string | null;
  avatarUrl: string | null;
  /** JSON blob of profile appearance choices; see lib/prefs.ts. */
  prefs: string | null;
  /** JSON array of declared subscriptions and API accounts; see lib/plans.ts. */
  plans: string | null;
  /** How many of the allowed handle changes are left. */
  handleChangesLeft: number;
  /** Whether the profile page is visible to anyone but its owner. */
  isPublic: boolean;
  /** Whether the account appears on the leaderboard. */
  listed: boolean;
}

export interface DeviceRow {
  id: string;
  user_id: string;
  hostname: string | null;
  platform: string | null;
  cli_version: string | null;
  linked_at: string;
  last_sync_at: string | null;
  revoked_at: string | null;
}

export interface LinkCodeRow {
  code: string;
  user_id: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
  device_id: string | null;
}

function toUserRow(profile: Profile): UserRow {
  return {
    id: profile.$id,
    handle: profile.handle,
    handle_lower: profile.handleLower,
    name: profile.name ?? null,
    bio: profile.bio ?? null,
    created_at: profile.createdAt,
    billing: profile.billing,
    links: profile.links ?? null,
    avatarUrl: profile.avatarUrl ?? null,
    prefs: profile.prefs ?? null,
    plans: profile.plans ?? null,
    handleChangesLeft: handleChangesLeft(profile),
    isPublic: profile.isPublic !== false,
    listed: listedFor(profile),
  };
}

function toDeviceRow(device: Device): DeviceRow {
  return {
    id: device.$id,
    user_id: device.userId,
    hostname: device.hostname ?? null,
    platform: device.platform ?? null,
    cli_version: device.cliVersion ?? null,
    linked_at: device.linkedAt,
    last_sync_at: device.lastSyncAt ?? null,
    revoked_at: device.revokedAt ?? null,
  };
}

function toLinkCodeRow(code: BackendLinkCode): LinkCodeRow {
  return {
    code: code.code,
    user_id: code.userId,
    created_at: code.createdAt,
    expires_at: code.expiresAt,
    consumed_at: code.consumedAt ?? null,
    device_id: code.deviceId ?? null,
  };
}

export interface PublicUser {
  id: string;
  handle: string;
  name?: string;
  bio?: string;
  createdAt: string;
  billing: string;
}

export function toPublicUser(row: UserRow): PublicUser {
  return {
    id: row.id,
    handle: row.handle,
    name: row.name ?? undefined,
    bio: row.bio ?? undefined,
    createdAt: row.created_at,
    billing: row.billing,
  };
}

/* ------------------------------------------------------------------ users */

export async function findUserByHandle(handle: string): Promise<UserRow | undefined> {
  // Dev only; see lib/fixtures.ts. Never true in a production build.
  if (fixturesOn()) {
    const fixture = fixtureProfile(handle);
    return fixture ? toUserRow(fixture) : undefined;
  }
  const profile = await findProfileByHandle(handle);
  return profile ? toUserRow(profile) : undefined;
}

export async function findUserById(userId: string): Promise<UserRow | undefined> {
  const profile = await findProfileById(userId);
  return profile ? toUserRow(profile) : undefined;
}

export async function createUser(
  handle: string,
  password: string,
  name?: string,
): Promise<UserRow> {
  const profile = await createProfile({ handle, password, name });
  profilesChanged();
  return toUserRow(profile);
}

/** Verify a handle/password pair. Returns the user, or undefined. */
export async function verifyLogin(
  handle: string,
  password: string,
): Promise<UserRow | undefined> {
  const profile = await backendAuthenticate(handle, password);
  return profile ? toUserRow(profile) : undefined;
}

export async function saveProfile(
  userId: string,
  patch: {
    name?: string | null;
    bio?: string | null;
    billing?: string;
    links?: string | null;
    prefs?: string | null;
    plans?: string | null;
    isPublic?: boolean;
    listed?: boolean;
  },
): Promise<void> {
  await updateProfile(userId, {
    name: patch.name ?? null,
    bio: patch.bio ?? null,
    billing: (patch.billing === "subscription" ? "subscription" : "api") as Profile["billing"],
    links: patch.links ?? null,
    prefs: patch.prefs ?? null,
    plans: patch.plans ?? null,
    isPublic: patch.isPublic !== false,
    // Private always wins: a hidden profile is never ranked.
    listed: patch.isPublic !== false && patch.listed !== false,
  });
  // Going private or unlisted has to take someone off the board now, not at
  // the next hourly refresh.
  profilesChanged();
}

/* --------------------------------------------------------------- sessions */

export async function createSession(userId: string): Promise<{ id: string; expiresAt: Date }> {
  return backendCreateSession(userId);
}

export async function deleteSession(sessionId: string): Promise<void> {
  await backendDeleteSession(sessionId);
}

/** The signed-in user for this request, or null. */
/**
 * Who is asking, resolved once per request.
 *
 * The root layout needs this to draw the account menu, and most pages need it
 * again for their own logic, so a single navigation asked two or three times
 * and each ask was a session lookup against the database. `cache` collapses
 * them into one for the life of a render: same answer, one read, and the
 * latency paid once instead of per caller.
 *
 * Per-request only, which is the point. A session that is revoked mid-request
 * would be a strange thing to notice halfway through rendering one page, and
 * the next request resolves it again from scratch.
 */
export const currentUser = cache(async (): Promise<UserRow | null> => {
  const store = await cookies();
  const profile = await resolveSession(store.get(SESSION_COOKIE)?.value);
  return profile ? toUserRow(profile) : null;
});

export async function setSessionCookie(sessionId: string, expiresAt: Date): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, sessionId, {
    httpOnly: true,
    sameSite: "lax",
    // Set over plain HTTP in local dev; the cookie would never be sent otherwise.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function clearSessionCookie(): Promise<string | undefined> {
  const store = await cookies();
  const existing = store.get(SESSION_COOKIE)?.value;
  store.delete(SESSION_COOKIE);
  return existing;
}

/* ------------------------------------------------------------- link codes */

export interface LinkCode {
  code: string;
  expiresAt: string;
}

export async function issueLinkCode(userId: string): Promise<LinkCode> {
  return backendIssueLinkCode(userId);
}

export async function readLinkCode(code: string): Promise<LinkCodeRow | undefined> {
  const row = await backendReadLinkCode(code);
  return row ? toLinkCodeRow(row) : undefined;
}

/** Trade a code for a device token. Single-use. */
export async function redeemLinkCode(
  code: string,
  device: { hostname?: string; platform?: string; cliVersion?: string },
): Promise<{ token: string; user: UserRow } | { error: "not_found" | "expired" | "used" }> {
  const result = await backendRedeemLinkCode(code, device);
  return result.ok
    ? { token: result.token, user: toUserRow(result.profile) }
    : { error: result.reason };
}

/* ---------------------------------------------------------------- devices */

/** Resolve an `Authorization: Bearer …` header to a device and its owner. */
export async function authenticateDevice(
  header: string | null,
): Promise<{ device: DeviceRow; user: UserRow } | null> {
  const result = await backendAuthenticateDevice(header);
  if (!result) return null;
  return { device: toDeviceRow(result.device), user: toUserRow(result.profile) };
}

export async function listDevices(userId: string): Promise<DeviceRow[]> {
  return (await backendListDevices(userId)).map(toDeviceRow);
}

export async function revokeDevice(userId: string, deviceId: string): Promise<void> {
  await backendRevokeDevice(userId, deviceId);
}
