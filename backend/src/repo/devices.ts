import { db, DB_ID, Query, isConflict, isNotFound } from "../client.ts";
import { hashToken, newDeviceToken, randomLinkCode } from "../crypto.ts";
import { newId } from "../ids.ts";
import { findProfileById, type Profile } from "./profiles.ts";

/**
 * CLI linking: short-lived codes traded for long-lived device tokens.
 *
 * The dashboard issues a code, the user pastes it into `tokn link`, and the
 * CLI trades it for a token. That direction needs no local callback server, so
 * it works over SSH and inside containers.
 */

const CODE_TTL_MINUTES = 10;

export interface LinkCode {
  $id: string;
  code: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
  consumedAt?: string | null;
  deviceId?: string | null;
}

export interface Device {
  $id: string;
  userId: string;
  tokenHash: string;
  hostname?: string | null;
  platform?: string | null;
  cliVersion?: string | null;
  linkedAt: string;
  lastSyncAt?: string | null;
  revokedAt?: string | null;
}

/* ------------------------------------------------------------- link codes */

/**
 * Issue a fresh code, retiring any the user still has outstanding — otherwise
 * reloading the link page would leave a trail of codes that all still work.
 */
export async function issueLinkCode(userId: string): Promise<{ code: string; expiresAt: string }> {
  const database = db();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + CODE_TTL_MINUTES * 60_000);

  const outstanding = await database.listDocuments(DB_ID, "link_codes", [
    Query.equal("userId", userId),
    Query.isNull("consumedAt"),
    Query.limit(25),
  ]);
  for (const doc of outstanding.documents) {
    await database.deleteDocument(DB_ID, "link_codes", doc.$id).catch(() => {});
  }

  // Collisions are vanishingly unlikely, but the unique index would 409 and a
  // user should never see that.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = randomLinkCode();
    try {
      await database.createDocument(DB_ID, "link_codes", newId("lc"), {
        code,
        userId,
        createdAt: now.toISOString(),
        expiresAt: expiresAt.toISOString(),
        consumedAt: null,
        deviceId: null,
      });
      return { code, expiresAt: expiresAt.toISOString() };
    } catch (error) {
      if (!isConflict(error)) throw error;
    }
  }

  throw new Error("could not allocate a link code");
}

export async function readLinkCode(code: string): Promise<LinkCode | null> {
  const result = await db().listDocuments(DB_ID, "link_codes", [
    Query.equal("code", code.toUpperCase()),
    Query.limit(1),
  ]);
  return (result.documents[0] as unknown as LinkCode) ?? null;
}

export type RedeemResult =
  | { ok: true; token: string; profile: Profile; deviceId: string }
  | { ok: false; reason: "not_found" | "expired" | "used" };

/**
 * Trade a code for a device token.
 *
 * Appwrite has no multi-document transaction, so single use is enforced by
 * claiming the code first — a conditional update guarded by the unique code
 * index — and only then minting the token. Two CLIs racing on the same code
 * means one claim wins and the loser sees "used"; the cost of that ordering is
 * a claimed-but-unused code if we crash between the two writes, which is
 * strictly safer than issuing two tokens.
 */
export async function redeemLinkCode(
  code: string,
  device: { hostname?: string; platform?: string; cliVersion?: string },
): Promise<RedeemResult> {
  const database = db();
  const row = await readLinkCode(code);

  if (!row) return { ok: false, reason: "not_found" };
  if (row.consumedAt) return { ok: false, reason: "used" };
  if (new Date(row.expiresAt).getTime() < Date.now()) return { ok: false, reason: "expired" };

  const profile = await findProfileById(row.userId);
  if (!profile) return { ok: false, reason: "not_found" };

  const deviceId = newId("dev");
  const now = new Date().toISOString();

  // Claim first. If another request already consumed it, this read-back shows
  // a different deviceId and we refuse.
  await database.updateDocument(DB_ID, "link_codes", row.$id, {
    consumedAt: now,
    deviceId,
  });

  const claimed = (await database.getDocument(
    DB_ID,
    "link_codes",
    row.$id,
  )) as unknown as LinkCode;
  if (claimed.deviceId !== deviceId) return { ok: false, reason: "used" };

  const token = newDeviceToken();
  await database.createDocument(DB_ID, "devices", deviceId, {
    userId: profile.$id,
    tokenHash: hashToken(token),
    hostname: device.hostname ?? null,
    platform: device.platform ?? null,
    cliVersion: device.cliVersion ?? null,
    linkedAt: now,
    lastSyncAt: null,
    revokedAt: null,
  });

  return { ok: true, token, profile, deviceId };
}

/* ---------------------------------------------------------------- devices */

/** Resolve an `Authorization: Bearer …` header to a device and its owner. */
export async function authenticateDevice(
  header: string | null,
): Promise<{ device: Device; profile: Profile } | null> {
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) return null;

  const result = await db().listDocuments(DB_ID, "devices", [
    Query.equal("tokenHash", hashToken(token)),
    Query.isNull("revokedAt"),
    Query.limit(1),
  ]);

  const device = result.documents[0] as unknown as Device | undefined;
  if (!device) return null;

  const profile = await findProfileById(device.userId);
  if (!profile) return null;

  return { device, profile };
}

export async function listDevices(userId: string): Promise<Device[]> {
  const result = await db().listDocuments(DB_ID, "devices", [
    Query.equal("userId", userId),
    Query.isNull("revokedAt"),
    Query.orderDesc("linkedAt"),
    Query.limit(100),
  ]);
  return result.documents as unknown as Device[];
}

export async function revokeDevice(userId: string, deviceId: string): Promise<boolean> {
  try {
    const device = (await db().getDocument(DB_ID, "devices", deviceId)) as unknown as Device;
    // Never let one account revoke another's device.
    if (device.userId !== userId) return false;
    await db().updateDocument(DB_ID, "devices", deviceId, {
      revokedAt: new Date().toISOString(),
    });
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

/**
 * Insert a device under an id the caller chose.
 *
 * OAuth sign-ins derive the id from the authorization code, so the second
 * attempt to spend a code collides here. Returns false on that collision
 * rather than throwing: it is an expected outcome, not a fault.
 */
export async function insertDevice(
  deviceId: string,
  fields: {
    userId: string;
    tokenHash: string;
    hostname: string | null;
    platform: string | null;
    cliVersion: string | null;
  },
): Promise<boolean> {
  try {
    await db().createDocument(DB_ID, "devices", deviceId, {
      ...fields,
      linkedAt: new Date().toISOString(),
      lastSyncAt: null,
      revokedAt: null,
    });
    return true;
  } catch (error) {
    if (isConflict(error)) return false;
    throw error;
  }
}

/**
 * Revoke a device with no owner check. Only for the server's own decisions —
 * a replayed OAuth code — never for an id that arrived in a request.
 */
export async function revokeDeviceById(deviceId: string): Promise<void> {
  try {
    await db().updateDocument(DB_ID, "devices", deviceId, {
      revokedAt: new Date().toISOString(),
    });
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

/** Revoke whichever live device holds the token with this hash, if one does. */
export async function revokeDeviceByTokenHash(tokenHash: string): Promise<void> {
  const result = await db().listDocuments(DB_ID, "devices", [
    Query.equal("tokenHash", tokenHash),
    Query.isNull("revokedAt"),
    Query.limit(1),
  ]);
  const device = result.documents[0];
  if (device) await revokeDeviceById(device.$id);
}

export async function touchDevice(deviceId: string, cliVersion?: string): Promise<void> {
  const patch: Record<string, unknown> = { lastSyncAt: new Date().toISOString() };
  if (cliVersion) patch.cliVersion = cliVersion;
  await db().updateDocument(DB_ID, "devices", deviceId, patch).catch(() => {});
}
