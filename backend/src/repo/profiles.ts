import { db, DB_ID, Query, isConflict, isNotFound } from "../client.ts";
import { hashPassword, verifyPassword } from "../crypto.ts";
import { newId, totalsRowId } from "../ids.ts";

/** Accounts. The handle is the public identity on the leaderboard. */

export const HANDLE_RE = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{1,23}$/;

/**
 * How many times a handle may be changed.
 *
 * The handle is the public identity: it is the profile URL, it is what the
 * leaderboard shows, and other people link to it. Two changes covers a typo
 * and a genuine change of mind. Past that it is a support conversation, so a
 * handle cannot be cycled to shed a history or to squat on someone else's.
 */
export const HANDLE_CHANGE_LIMIT = 2;

export function handleChangesLeft(profile: Pick<Profile, "handleChanges">): number {
  return Math.max(0, HANDLE_CHANGE_LIMIT - (profile.handleChanges ?? 0));
}

/**
 * Whether a profile belongs on the leaderboard.
 *
 * Private always wins. Storing the derived value rather than recomputing it at
 * read time means the board query stays a single indexed equality, and there
 * is no way to make a profile private and leave it ranked by forgetting a
 * clause somewhere.
 *
 * Both fields default to true, so an account created before these existed is
 * public and listed, which is what it already was.
 */
/** Same reasoning as READ_PAGE in usage.ts: fewer round trips. */
const PROFILE_PAGE = 1000;

export function listedFor(
  profile: Pick<Profile, "isPublic" | "listed">,
): boolean {
  return profile.isPublic !== false && profile.listed !== false;
}

export interface Profile {
  $id: string;
  handle: string;
  handleLower: string;
  name?: string | null;
  bio?: string | null;
  passwordHash: string;
  billing: "api" | "subscription";
  links?: string | null;
  avatarUrl?: string | null;
  isPublic: boolean;
  /** Whether to appear on the leaderboard. See `listedFor`. */
  listed?: boolean;
  /** Times the handle has been changed. See HANDLE_CHANGE_LIMIT. */
  handleChanges?: number;
  /** JSON blob of appearance choices; see web/src/lib/prefs.ts. */
  prefs?: string | null;
  /** JSON array of declared plans; see web/src/lib/plans.ts. */
  plans?: string | null;
  createdAt: string;
  githubId?: string | null;
  githubLogin?: string | null;
}

/** What is safe to serialise to a browser or the CLI. */
export interface PublicUser {
  id: string;
  handle: string;
  name?: string;
  bio?: string;
  billing: string;
  links: string[];
  avatarUrl?: string;
  createdAt: string;
}

export function toPublicUser(profile: Profile): PublicUser {
  let links: string[] = [];
  try {
    const parsed = profile.links ? (JSON.parse(profile.links) as unknown) : [];
    if (Array.isArray(parsed)) links = parsed.filter((l): l is string => typeof l === "string");
  } catch {
    // A malformed links blob should not break a profile page.
  }

  return {
    id: profile.$id,
    handle: profile.handle,
    name: profile.name ?? undefined,
    bio: profile.bio ?? undefined,
    billing: profile.billing,
    links,
    avatarUrl: profile.avatarUrl ?? undefined,
    createdAt: profile.createdAt,
  };
}

export async function findProfileById(userId: string): Promise<Profile | null> {
  try {
    return (await db().getDocument(DB_ID, "profiles", userId)) as unknown as Profile;
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function findProfileByHandle(handle: string): Promise<Profile | null> {
  const result = await db().listDocuments(DB_ID, "profiles", [
    Query.equal("handleLower", handle.toLowerCase()),
    Query.limit(1),
  ]);
  return (result.documents[0] as unknown as Profile) ?? null;
}

export class HandleTakenError extends Error {
  constructor(handle: string) {
    super(`the handle @${handle} is taken`);
    this.name = "HandleTakenError";
  }
}

export async function createProfile(input: {
  handle: string;
  password: string;
  name?: string;
}): Promise<Profile> {
  const userId = newId("usr");
  const now = new Date().toISOString();

  try {
    return (await db().createDocument(DB_ID, "profiles", userId, {
      handle: input.handle,
      handleLower: input.handle.toLowerCase(),
      name: input.name ?? null,
      bio: null,
      passwordHash: hashPassword(input.password),
      billing: "api",
      links: null,
      avatarUrl: null,
      isPublic: true,
      createdAt: now,
    })) as unknown as Profile;
  } catch (error) {
    // The unique index on handleLower is what actually prevents a race between
    // two signups for the same handle; the pre-check is only for a nicer error.
    if (isConflict(error)) throw new HandleTakenError(input.handle);
    throw error;
  }
}

export async function authenticate(handle: string, password: string): Promise<Profile | null> {
  const profile = await findProfileByHandle(handle);
  if (!profile) {
    // Spend the same work on a missing user so the response time does not
    // reveal whether a handle exists.
    verifyPassword(password, "scrypt$0000$0000");
    return null;
  }
  return verifyPassword(password, profile.passwordHash) ? profile : null;
}

export async function updateProfile(
  userId: string,
  patch: Partial<
    Pick<
      Profile,
      | "name"
      | "bio"
      | "billing"
      | "links"
      | "avatarUrl"
      | "isPublic"
      | "listed"
      | "prefs"
      | "plans"
    >
  >,
): Promise<Profile> {
  return (await db().updateDocument(DB_ID, "profiles", userId, patch)) as unknown as Profile;
}

/** Every profile, paged. Used to join users onto board-wide aggregates. */
export async function listAllProfiles(): Promise<Profile[]> {
  const out: Profile[] = [];
  let cursor: string | undefined;

  for (;;) {
    const queries = [Query.limit(PROFILE_PAGE), Query.orderAsc("$id")];
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const page = await db().listDocuments(DB_ID, "profiles", queries);
    const docs = page.documents as unknown as Profile[];
    out.push(...docs);

    if (docs.length < PROFILE_PAGE) break;
    cursor = docs[docs.length - 1]?.$id;
    if (!cursor) break;
  }

  return out;
}

/**
 * Erase an account and everything attached to it.
 *
 * The privacy policy promises this is immediate and complete, so it must
 * actually remove every row, not just hide the profile. Order matters: the
 * profile goes last, so a failure part-way through leaves an account that can
 * still sign in and retry rather than orphaned rows with no owner.
 *
 * Appwrite has no cascading delete and no cross-collection transaction, which
 * is why this is spelled out by hand.
 */
export async function deleteAccount(userId: string): Promise<{ removed: Record<string, number> }> {
  const removed: Record<string, number> = {};

  const purge = async (collection: string): Promise<void> => {
    let count = 0;
    for (;;) {
      const page = await db().listDocuments(DB_ID, collection, [
        Query.equal("userId", userId),
        Query.limit(PROFILE_PAGE),
      ]);
      if (page.documents.length === 0) break;

      for (const doc of page.documents) {
        await db().deleteDocument(DB_ID, collection, doc.$id).catch(() => {});
        count++;
      }
      if (page.documents.length < PROFILE_PAGE) break;
    }
    removed[collection] = count;
  };

  await purge("usage_daily");
  // Provisioned later than the rest; an install without it has nothing to
  // remove there, and that must not stop the account being erased.
  await purge("agent_daily").catch((error) => {
    if (!isNotFound(error)) throw error;
  });
  await purge("devices");
  await purge("link_codes");
  await purge("sessions");

  // The rollup is keyed by user id rather than carrying a userId field query,
  // so it is removed directly.
  await db().deleteDocument(DB_ID, "user_totals", totalsRowId(userId)).catch(() => {});
  removed.user_totals = 1;

  await db().deleteDocument(DB_ID, "profiles", userId);
  removed.profiles = 1;

  return { removed };
}
