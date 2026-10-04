import crypto from "node:crypto";
import { findOAuthClient, type OAuthClient, type OAuthScope } from "./clients.ts";

/**
 * How an app sign-in is recorded: as an ordinary row in `devices`.
 *
 * The access token an app receives *is* a device token, so `/api/cli/me`,
 * `/api/cli/sync` and the rest accept it unchanged, it appears in the
 * account's machine list, and the revoke button there already works on it.
 * No new collection and no new attribute — which also means the row has
 * nowhere to keep app-specific facts, so two existing fields carry them:
 *
 *   $id         `oa…` or `op…`, derived from the authorization code. The id
 *               is what makes a code single-use (a second redemption collides
 *               with the first row), and its prefix records whether the grant
 *               included `usage:write`, since a device row has no scope field
 *               and the token would otherwise be able to do anything a CLI
 *               token can.
 *   cliVersion  `<client_id>/<app version>`, which is how the account page
 *               knows to say "Eaon Desktop" rather than show a hostname.
 *
 * Neither can be forged by the app: the id is chosen here, and a sync keeps
 * the client prefix whatever version string it is sent.
 */

/** Matches `devices.cliVersion`'s attribute size in schema.ts. */
const VERSION_SIZE = 32;

const WRITE_PREFIX = "oa";
const READ_PREFIX = "op";
const OAUTH_ID = /^o[ap][0-9a-f]{34}$/;

/** Deterministic, so redeeming the same code twice addresses the same row. */
export function oauthDeviceId(code: string, scopes: readonly OAuthScope[]): string {
  const prefix = scopes.includes("usage:write") ? WRITE_PREFIX : READ_PREFIX;
  return prefix + crypto.createHash("sha256").update(code).digest("hex").slice(0, 34);
}

export function isOAuthDevice(deviceId: string): boolean {
  return OAUTH_ID.test(deviceId);
}

/**
 * May this device upload usage? Every CLI device may; an app may only if the
 * person allowed `usage:write` when it signed in.
 */
export function deviceMayUpload(deviceId: string): boolean {
  return !(isOAuthDevice(deviceId) && deviceId.startsWith(READ_PREFIX));
}

/** `eaon-desktop/2026.6.0`, clipped to the column. */
export function appVersionLabel(client: OAuthClient, version: string | null | undefined): string {
  const room = VERSION_SIZE - client.id.length - 1;
  const clean = (version ?? "").replace(/[^A-Za-z0-9._+-]/g, "").slice(0, Math.max(0, room));
  return clean ? `${client.id}/${clean}` : client.id;
}

/**
 * Which app, if any, a device row belongs to — for display.
 *
 * Requires both the id shape and the version prefix. The id alone cannot say
 * which client; the prefix alone could be typed into any CLI sync.
 */
export function oauthAppForDevice(
  deviceId: string,
  cliVersion: string | null | undefined,
): { client: OAuthClient; version: string | null } | null {
  if (!isOAuthDevice(deviceId) || !cliVersion) return null;

  const slash = cliVersion.indexOf("/");
  const client = findOAuthClient(slash === -1 ? cliVersion : cliVersion.slice(0, slash));
  if (!client) return null;

  const version = slash === -1 ? "" : cliVersion.slice(slash + 1);
  return { client, version: version || null };
}

/**
 * The version string to store when a device syncs.
 *
 * A CLI reports its own version and that is stored as sent. An app's row has
 * to keep its client prefix, or the first sync would overwrite
 * `eaon-desktop/2026.6.0` with `2026.6.0` and the account page would forget
 * what the device is.
 */
export function versionAfterSync(
  device: { $id: string; cliVersion?: string | null },
  reported: string | undefined,
): string | undefined {
  const app = oauthAppForDevice(device.$id, device.cliVersion);
  if (!app) return reported;
  if (!reported) return undefined;

  const prefix = `${app.client.id}/`;
  return appVersionLabel(app.client, reported.startsWith(prefix) ? reported.slice(prefix.length) : reported);
}
