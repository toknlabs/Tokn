import { ENV } from "../env.ts";
import { insertDevice, revokeDeviceById, revokeDeviceByTokenHash } from "../repo/devices.ts";
import { findProfileById } from "../repo/profiles.ts";
import { oauthKey } from "./code.ts";
import type { OAuthParams } from "./params.ts";
import {
  authorizationServerMetadata,
  exchangeToken,
  revokeToken,
  type OAuthReply,
  type OAuthStore,
} from "./token.ts";

/**
 * The OAuth endpoints, bound to Appwrite and the deployment's environment.
 *
 * Everything with a rule in it is in `token.ts` and `authorize.ts`; this file
 * only supplies the real store, the real key and the real origin.
 */

export const appwriteOAuthStore: OAuthStore = {
  async findUser(userId) {
    const profile = await findProfileById(userId);
    return profile ? { id: profile.$id, handle: profile.handle, name: profile.name ?? null } : null;
  },
  createDevice: (id, device) => insertDevice(id, device),
  revokeDevice: (id) => revokeDeviceById(id),
  revokeTokenHash: (tokenHash) => revokeDeviceByTokenHash(tokenHash),
};

/** The key codes are signed and checked with. See `oauthKey`. */
export function oauthSigningKey(): Buffer {
  return oauthKey(process.env);
}

export function oauthToken(params: OAuthParams | null): Promise<OAuthReply> {
  return exchangeToken(params, {
    store: appwriteOAuthStore,
    key: oauthSigningKey(),
    publicUrl: ENV.publicUrl,
  });
}

export function oauthRevoke(params: OAuthParams | null): Promise<OAuthReply> {
  return revokeToken(params, appwriteOAuthStore);
}

export function oauthMetadata(): Record<string, unknown> {
  return authorizationServerMetadata(ENV.publicUrl);
}
