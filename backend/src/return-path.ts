/**
 * Where to send someone after they sign in.
 *
 * Every sign-in path carries a return address — `/login?next=…`, the GitHub
 * state, the "switch account" button on the OAuth consent screen — and every
 * one of them is attacker-supplied. A check of "starts with one slash" is not
 * enough: browsers read `/\evil.com` as `//evil.com`, strip tabs and newlines
 * out of URLs before parsing them, and normalise `/.//evil.com` down to a
 * scheme-relative `//evil.com`. Each of those turns a same-site path into an
 * open redirect.
 *
 * So the value is resolved the way a browser would resolve it, and what comes
 * back is the *normalised* form: a path that still begins with exactly one
 * slash after normalisation cannot leave the site, whether it ends up in a
 * Location header, `redirect()` or `router.push`.
 */

const BASE = "http://tokn.invalid";

/** Long enough for an OAuth authorize URL, short enough to stay a URL. */
const MAX_LENGTH = 2048;

/** A same-site relative path to return to, or null if it is not one. */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || value.length > MAX_LENGTH) return null;
  if (!value.startsWith("/")) return null;

  // Backslashes and control characters are never part of a path we issue, and
  // both are how a "relative" value gets reinterpreted as another host.
  if (/[\\\u0000-\u001f\u007f]/.test(value)) return null;

  let url: URL;
  try {
    url = new URL(value, BASE);
  } catch {
    return null;
  }

  if (url.origin !== BASE) return null;
  // Dot segments can collapse `/.//host` into `//host` during normalisation.
  if (url.pathname.startsWith("//")) return null;

  return `${url.pathname}${url.search}${url.hash}`;
}
