/**
 * Sign in with tokn — an OAuth 2.0 authorization server for native apps.
 *
 *   clients.ts    the registry, scopes, and loopback redirect rules
 *   code.ts       signed authorization codes, PKCE, the signing key
 *   authorize.ts  the authorize decision, approve / deny, the origin check
 *   token.ts      token exchange and revocation against a store interface
 *   devices.ts    how an app's grant is recorded as a device row
 *   service.ts    the same, bound to Appwrite
 *
 * See OAUTH.md beside the backend README for the flow end to end.
 */

export * from "./clients.ts";
export * from "./code.ts";
export * from "./params.ts";
export * from "./authorize.ts";
export * from "./token.ts";
export * from "./devices.ts";
export * from "./service.ts";
