/**
 * The URL a route handler was requested with, exactly as the browser sent it.
 *
 * `request.url` in a route handler is Next's normalised URL, and that
 * normalising replaces the first `127.x.x.x` or `[::1]` anywhere in the URL
 * with `localhost` — query string included. On toknhq.com the host is not one
 * of those, so the first match is an app's loopback `redirect_uri`:
 * `http://127.0.0.1:60802/callback` arrives as `http://localhost:60802/callback`,
 * which is not the address the app is listening on nor the one it sends to the
 * token endpoint, so sign-in fails at the last step. Locally the host is
 * `localhost` itself and soaks up the replacement, so this only shows in
 * production.
 *
 * The standard Request underneath keeps the original; its own `url` getter,
 * which NextRequest overrides, still returns it.
 */
const nativeUrl = Object.getOwnPropertyDescriptor(Request.prototype, "url")?.get;

export function requestUrl(request: Request): URL {
  const raw: unknown = nativeUrl?.call(request);
  return new URL(typeof raw === "string" && raw.length > 0 ? raw : request.url);
}
