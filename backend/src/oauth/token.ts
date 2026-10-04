import { hashToken, newDeviceToken } from "../crypto.ts";
import { findOAuthClient, OAUTH_SCOPES, resolveScopes } from "./clients.ts";
import { isCodeVerifier, pkceMatches, safeEqual, verifyCode } from "./code.ts";
import { appVersionLabel, oauthDeviceId } from "./devices.ts";
import { oauthParam, type OAuthParams } from "./params.ts";

/**
 * The token and revocation endpoints, written against a store interface.
 *
 * Every rule lives here and none of the persistence does, so the tests can run
 * the whole exchange — single use included — against an in-memory store, and
 * the Appwrite version (`service.ts`) is a few lines of glue.
 */

export interface OAuthUser {
  id: string;
  handle: string;
  name: string | null;
}

export interface NewDevice {
  userId: string;
  tokenHash: string;
  hostname: string;
  platform: string | null;
  cliVersion: string;
}

export interface OAuthStore {
  findUser(userId: string): Promise<OAuthUser | null>;
  /** Insert a device row under exactly this id. False if the id is taken. */
  createDevice(id: string, device: NewDevice): Promise<boolean>;
  /** Revoke one device by id. A missing row is not an error. */
  revokeDevice(id: string): Promise<void>;
  /** Revoke whichever live device holds this token hash, if any. */
  revokeTokenHash(tokenHash: string): Promise<void>;
}

/** A response, already shaped: the route only serialises it. */
export interface OAuthReply {
  status: number;
  body: Record<string, unknown>;
}

export interface TokenSuccess {
  access_token: string;
  token_type: "Bearer";
  scope: string;
  user: { id: string; handle: string; name: string | null };
  profile_url: string;
}

/** RFC 6749 §5.2. `invalid_client` is the one that is a 401. */
function error(code: string, description: string): OAuthReply {
  return {
    status: code === "invalid_client" ? 401 : 400,
    body: { error: code, error_description: description },
  };
}

/** Strip control characters and clip, so a device name renders as text. */
function clean(value: string | null, max: number): string | null {
  if (value === null) return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  return text.length > 0 ? text : null;
}

/* ------------------------------------------------- POST /api/oauth/token */

export async function exchangeToken(
  params: OAuthParams | null,
  deps: { store: OAuthStore; key: Uint8Array; publicUrl: string; now?: number },
): Promise<OAuthReply> {
  if (!params) return error("invalid_request", "the body could not be read");

  const names = [
    "grant_type",
    "code",
    "redirect_uri",
    "client_id",
    "code_verifier",
    "device_name",
    "platform",
    "app_version",
  ] as const;
  const read = Object.fromEntries(names.map((name) => [name, oauthParam(params, name)])) as Record<
    (typeof names)[number],
    ReturnType<typeof oauthParam>
  >;
  if (Object.values(read).some((param) => param.repeated)) {
    return error("invalid_request", "a parameter was repeated");
  }

  const grantType = read.grant_type.value;
  if (!grantType) return error("invalid_request", "grant_type is required");
  if (grantType !== "authorization_code") {
    return error("unsupported_grant_type", "only authorization_code is supported");
  }

  const client = findOAuthClient(read.client_id.value);
  if (!client) return error("invalid_client", "unknown client_id");

  const code = read.code.value;
  const redirectUri = read.redirect_uri.value;
  const verifier = read.code_verifier.value;
  if (!code) return error("invalid_request", "code is required");
  if (!redirectUri) return error("invalid_request", "redirect_uri is required");
  if (!verifier) return error("invalid_request", "code_verifier is required");
  if (!isCodeVerifier(verifier)) {
    return error("invalid_request", "code_verifier must be 43-128 characters of [A-Za-z0-9-._~]");
  }

  const checked = verifyCode(code, deps.key, deps.now);
  if (!checked.ok) {
    return error(
      "invalid_grant",
      checked.reason === "expired" ? "the code has expired" : "the code is not valid",
    );
  }

  const claims = checked.claims;
  if (!safeEqual(claims.clientId, client.id)) {
    return error("invalid_grant", "the code was issued to another client");
  }
  if (!safeEqual(claims.redirectUri, redirectUri)) {
    return error("invalid_grant", "redirect_uri does not match the one the code was issued for");
  }
  if (!pkceMatches(verifier, claims.codeChallenge)) {
    return error("invalid_grant", "code_verifier does not match the code_challenge");
  }

  // Re-read against the registry as it is now, not as it was two minutes ago.
  // An empty scope would resolve to the client's defaults, so it is refused
  // rather than read; `approveAuthorization` never signs one.
  const scopes = claims.scope ? resolveScopes(client, claims.scope) : null;
  if (!scopes?.ok) return error("invalid_grant", "the code carries a scope this client does not have");

  const user = await deps.store.findUser(claims.userId);
  if (!user) return error("invalid_grant", "the account no longer exists");

  const token = newDeviceToken();
  const deviceId = oauthDeviceId(code, scopes.scopes);
  const created = await deps.store.createDevice(deviceId, {
    userId: user.id,
    tokenHash: hashToken(token),
    hostname: clean(read.device_name.value, 128) ?? client.name,
    platform: clean(read.platform.value, 32),
    cliVersion: appVersionLabel(client, read.app_version.value),
  });

  if (!created) {
    // The code has been spent already. RFC 6749 §4.1.2 asks that whatever it
    // bought be revoked too: a second redemption means either a confused
    // client, which lost the first token anyway, or a copied code.
    await deps.store.revokeDevice(deviceId);
    return error("invalid_grant", "the code has already been used");
  }

  const success: TokenSuccess = {
    access_token: token,
    token_type: "Bearer",
    scope: scopes.scopes.join(" "),
    user: { id: user.id, handle: user.handle, name: user.name },
    profile_url: `${deps.publicUrl.replace(/\/+$/, "")}/profile/${user.handle}`,
  };
  return { status: 200, body: { ...success } };
}

/* ------------------------------------------------ POST /api/oauth/revoke */

/**
 * RFC 7009. Always succeeds from the caller's point of view: an unknown,
 * already-revoked or missing token gets the same 200 as a live one, so the
 * endpoint cannot be used to test whether a token exists.
 *
 * Holding a token is enough to revoke it. That covers CLI tokens as well as
 * app tokens, which is no new power — whoever holds one can already act as
 * that device until the owner revokes it from the account page.
 */
export async function revokeToken(params: OAuthParams | null, store: OAuthStore): Promise<OAuthReply> {
  const token = params ? oauthParam(params, "token") : null;
  if (token?.value && !token.repeated && token.value.length <= 256) {
    await store.revokeTokenHash(hashToken(token.value));
  }
  return { status: 200, body: {} };
}

/* ------------------------- GET /.well-known/oauth-authorization-server */

/** RFC 8414 metadata, so a client can discover the endpoints rather than hardcode them. */
export function authorizationServerMetadata(publicUrl: string): Record<string, unknown> {
  const issuer = publicUrl.replace(/\/+$/, "");
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/api/oauth/token`,
    revocation_endpoint: `${issuer}/api/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    // Omitted, this would default to client_secret_basic, which nobody here has.
    revocation_endpoint_auth_methods_supported: ["none"],
    scopes_supported: Object.keys(OAUTH_SCOPES),
  };
}
