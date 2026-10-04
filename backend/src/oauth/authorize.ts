import {
  findOAuthClient,
  isAllowedRedirect,
  resolveScopes,
  scopeString,
  type OAuthClient,
  type OAuthScope,
} from "./clients.ts";
import { isCodeChallenge, signCode } from "./code.ts";
import { oauthParam, type OAuthParams } from "./params.ts";

/**
 * The authorization endpoint, as a decision.
 *
 * `GET /oauth/authorize` acts on whatever this returns, the consent screen at
 * `/oauth/consent` runs it again before rendering, and `POST
 * /api/oauth/authorize` runs it a third time on the submitted form before
 * signing anything, so none of them can disagree about what is valid.
 *
 * The one rule that shapes everything: **until the client and its redirect URI
 * have both checked out, nothing redirects.** An error at that stage is shown
 * to the person on our own page. Sending it to the redirect URI would turn this
 * endpoint into an open redirect for anyone who can type a URL. Only once the
 * address is known to be the app's own loopback do errors go back to it, the
 * way RFC 6749 §4.1.2.1 describes.
 */

/** States are opaque to us and echoed back; this is far beyond any real one. */
const MAX_STATE = 1024;

/** The parameters the consent form carries, and the only ones it carries. */
export const AUTHORIZE_PARAMS = [
  "response_type",
  "client_id",
  "redirect_uri",
  "code_challenge",
  "code_challenge_method",
  "state",
  "scope",
] as const;

export interface AuthorizeRequest {
  client: OAuthClient;
  redirectUri: string;
  codeChallenge: string;
  scopes: OAuthScope[];
  state: string | null;
}

export type AuthorizeOutcome =
  /** Render this on our page. The redirect URI is not trusted, so never use it. */
  | { kind: "invalid"; description: string }
  /** An error the app should hear about, addressed to its validated redirect. */
  | { kind: "redirect"; location: string }
  /** Valid: ask the person. */
  | { kind: "consent"; request: AuthorizeRequest };

export function authorizeRequest(params: OAuthParams): AuthorizeOutcome {
  const clientId = oauthParam(params, "client_id");
  if (clientId.repeated || !clientId.value) {
    return { kind: "invalid", description: "this link does not say which app is asking" };
  }

  const client = findOAuthClient(clientId.value);
  if (!client) {
    return { kind: "invalid", description: "this link is from an app tokn does not know" };
  }

  const redirect = oauthParam(params, "redirect_uri");
  if (redirect.repeated || !isAllowedRedirect(client, redirect.value)) {
    return {
      kind: "invalid",
      description: `${client.name} asked to send you somewhere it is not allowed to`,
    };
  }

  // From here the address is the app's own loopback, so errors go back to it.
  const redirectUri = redirect.value;
  const state = oauthParam(params, "state");
  const echo = !state.repeated && state.value !== null && state.value.length <= MAX_STATE
    ? state.value
    : null;
  const fail = (error: string, description: string): AuthorizeOutcome => ({
    kind: "redirect",
    location: backTo(redirectUri, { error, error_description: description, state: echo }),
  });

  if (state.repeated || (state.value?.length ?? 0) > MAX_STATE) {
    return fail("invalid_request", "state is repeated or too long");
  }

  const responseType = oauthParam(params, "response_type");
  const challenge = oauthParam(params, "code_challenge");
  const method = oauthParam(params, "code_challenge_method");
  const scope = oauthParam(params, "scope");
  if ([responseType, challenge, method, scope].some((param) => param.repeated)) {
    return fail("invalid_request", "a parameter was repeated");
  }

  if (!responseType.value) return fail("invalid_request", "response_type is required");
  if (responseType.value !== "code") {
    return fail("unsupported_response_type", "only response_type=code is supported");
  }

  if (method.value !== "S256") {
    return fail("invalid_request", "PKCE with code_challenge_method=S256 is required");
  }
  if (!isCodeChallenge(challenge.value)) {
    return fail("invalid_request", "code_challenge must be a base64url SHA-256 (43 characters)");
  }

  const scopes = resolveScopes(client, scope.value);
  if (!scopes.ok) return fail("invalid_scope", `unknown scope: ${scopes.unknown}`);

  return {
    kind: "consent",
    request: {
      client,
      redirectUri,
      codeChallenge: challenge.value,
      scopes: scopes.scopes,
      state: echo,
    },
  };
}

/** Where the browser goes when the person approves: the code, and the state. */
export function approveAuthorization(
  request: AuthorizeRequest,
  userId: string,
  key: Uint8Array,
  now: number = Date.now(),
): string {
  const code = signCode(
    {
      userId,
      clientId: request.client.id,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      scope: scopeString(request.scopes),
    },
    key,
    now,
  );
  return backTo(request.redirectUri, { code, state: request.state });
}

/** Where the browser goes when the person says no. */
export function denyAuthorization(request: AuthorizeRequest): string {
  return backTo(request.redirectUri, {
    error: "access_denied",
    error_description: "the request was declined",
    state: request.state,
  });
}

/**
 * Append the response to a redirect URI.
 *
 * Only ever called with one that `isAllowedRedirect` passed — every caller
 * gets it from an `AuthorizeRequest` or from inside `authorizeRequest` after
 * that check.
 */
function backTo(redirectUri: string, values: Record<string, string | null>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(values)) {
    if (value !== null) url.searchParams.set(key, value);
  }
  return url.href;
}

/**
 * The authorize URL to come back to after signing in — or, with `pathname`,
 * the consent screen for the same request — rebuilt from the parameters that
 * matter. Anything else on the original URL is dropped, so the path cannot be
 * used to smuggle extra fields into the consent form.
 */
export function authorizePath(params: OAuthParams, pathname = "/oauth/authorize"): string {
  const kept = new URLSearchParams();
  for (const name of AUTHORIZE_PARAMS) {
    for (const value of params.getAll(name)) kept.append(name, value);
  }
  return `${pathname}?${kept.toString()}`;
}

/**
 * Did this request come from one of our own pages?
 *
 * The consent form posts with the session cookie, so a page elsewhere that
 * auto-submits a copy of it would approve on the person's behalf. Browsers
 * always send `Origin` on a POST and a page cannot forge it, so it has to be
 * present and has to be ours. `SameSite=Lax` on the session cookie is a second
 * layer, not the first.
 */
export function isSameOrigin(origin: string | null, allowed: readonly string[]): boolean {
  if (!origin || origin === "null") return false;
  return allowed.some((candidate) => {
    try {
      return new URL(candidate).origin === origin;
    } catch {
      return false;
    }
  });
}
