/**
 * The apps that may use "Sign in with tokn".
 *
 * Kept in code rather than in a collection: there are a handful of them, each
 * is a decision someone made deliberately, and a registry that needs no
 * provisioning cannot drift out of step between environments.
 *
 * Every client here is a **public native client** (RFC 8252). A desktop app
 * cannot keep a secret — anyone can pull it out of the binary — so there is no
 * client secret at all. What stands in for one is PKCE plus a redirect that can
 * only reach the user's own machine: a loopback address on a port the app
 * opened for this one sign-in.
 *
 * Adding a client is one entry below. Its scopes must come from `SCOPES`.
 */

export type OAuthScope = "profile" | "usage:write";

/**
 * What each scope lets an app do, in the words the consent screen uses.
 *
 * The order here is the order they are listed in, and the canonical order of
 * a granted scope string.
 */
export const OAUTH_SCOPES: Record<OAuthScope, string> = {
  profile: "see your handle and profile",
  "usage:write":
    "upload your daily usage totals: requests, tokens and cost per model per day — never prompts, code or file names",
};

const SCOPE_ORDER = Object.keys(OAUTH_SCOPES) as OAuthScope[];

export interface OAuthClient {
  id: string;
  /** Shown on the consent screen and in the account's device list. */
  name: string;
  /** The app's own icon, served from `web/public`, for the consent screen and the welcome flow. */
  icon: string;
  /** Everything it may ask for; also what it gets when it asks for nothing. */
  scopes: readonly OAuthScope[];
  /**
   * The path its loopback redirect must use. Any loopback host form and any
   * unprivileged port is accepted, as RFC 8252 §7.3 requires: the app picks a
   * free port at sign-in time and cannot know it in advance.
   */
  loopbackPath: string;
}

export const OAUTH_CLIENTS: readonly OAuthClient[] = [
  {
    id: "eaon-desktop",
    name: "Eaon Desktop",
    icon: "/apps/eaon-desktop.png",
    scopes: ["profile", "usage:write"],
    loopbackPath: "/callback",
  },
];

export function findOAuthClient(clientId: unknown): OAuthClient | null {
  if (typeof clientId !== "string") return null;
  return OAUTH_CLIENTS.find((client) => client.id === clientId) ?? null;
}

/**
 * The app waiting at the end of a return path, if that path is an app's
 * sign-in (`/oauth/authorize?client_id=…`). Someone new who creates an
 * account in the middle of signing in to an app goes through the welcome
 * flow first; this is how that flow knows which app to send them back to,
 * and what to call it. Only the client is read here: whether the rest of the
 * request is valid is decided when they get there.
 */
export function appWaitingAt(returnPath: string | null | undefined): OAuthClient | null {
  if (!returnPath) return null;
  try {
    const url = new URL(returnPath, "http://tokn.invalid");
    if (url.pathname !== "/oauth/authorize") return null;
    return findOAuthClient(url.searchParams.get("client_id"));
  } catch {
    return null;
  }
}

/* --------------------------------------------------------- redirect URIs */

/**
 * The three loopback spellings, a port, and nothing else.
 *
 * Matched on the raw string before any parsing. A URL parser is generous in
 * ways that matter here — it accepts `127.1`, `0x7f.0.0.1`, upper case, a
 * trailing dot and `user:pass@` — and every one of those would let the string
 * the token endpoint compares against differ from the one the person saw.
 * Userinfo, a query, a fragment, a trailing slash or a leading zero on the
 * port all fail to match.
 */
const LOOPBACK = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\]):([1-9][0-9]{3,4})(\/[^?#]*)$/;

const MIN_PORT = 1024;
const MAX_PORT = 65535;

/** Is this one of the loopback redirects a client with `path` may use? */
export function isLoopbackRedirect(uri: unknown, path: string): boolean {
  if (typeof uri !== "string") return false;

  const match = LOOPBACK.exec(uri);
  if (!match) return false;

  const port = Number(match[2]);
  if (port < MIN_PORT || port > MAX_PORT) return false;
  if (match[3] !== path) return false;

  // Belt and braces: the parser must read it back as exactly what was matched.
  try {
    return new URL(uri).href === uri;
  } catch {
    return false;
  }
}

export function isAllowedRedirect(client: OAuthClient, uri: unknown): uri is string {
  return isLoopbackRedirect(uri, client.loopbackPath);
}

/* ---------------------------------------------------------------- scopes */

export type ScopeResult = { ok: true; scopes: OAuthScope[] } | { ok: false; unknown: string };

/**
 * Read a requested `scope` against what the client may have.
 *
 * Omitted or empty means everything the client is registered for. Anything
 * the client is not registered for is refused outright rather than silently
 * dropped, so an app can never believe it holds a scope it does not.
 */
export function resolveScopes(client: OAuthClient, requested: string | null | undefined): ScopeResult {
  const words = (requested ?? "").split(" ").filter((word) => word.length > 0);
  if (words.length === 0) return { ok: true, scopes: [...client.scopes] };

  for (const word of words) {
    if (!(client.scopes as readonly string[]).includes(word)) return { ok: false, unknown: word };
  }

  return { ok: true, scopes: SCOPE_ORDER.filter((scope) => words.includes(scope)) };
}

export function scopeString(scopes: readonly OAuthScope[]): string {
  return SCOPE_ORDER.filter((scope) => scopes.includes(scope)).join(" ");
}
