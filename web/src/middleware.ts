import { NextResponse, type NextRequest } from "next/server";

/**
 * Two hostnames, one deployment.
 *
 * toknhq.com is the whole site. tokns.eaon.dev serves the Eaon Desktop board
 * and profiles, and nothing else:
 *
 *   tokns.eaon.dev/             → /eaon          (the Eaon board)
 *   tokns.eaon.dev/@handle      → /eaon/handle   (an Eaon profile)
 *   tokns.eaon.dev/api/…        unchanged, so an app pointed at either host works
 *   tokns.eaon.dev/anything-else → toknhq.com/anything-else
 *   toknhq.com/eaon[/handle]     → tokns.eaon.dev[/@handle]   (production)
 *
 * Everything else goes to toknhq.com rather than rendering here, sign-in
 * above all. Sessions, the OAuth consent screen and its Origin check all
 * belong to one origin; a login form served on the Eaon host would set a
 * cookie toknhq.com never sees and post an Origin the consent check refuses.
 *
 * Rewritten pages carry `x-tokn-site: eaon`, which the root layout reads to
 * swap the chrome. The header is stripped from every incoming request first,
 * so nothing outside can claim it.
 *
 * Testing locally, with no DNS: set `TOKN_EAON_HOSTS=127.0.0.1:3107` and
 * `localhost:3107` stays tokn while `127.0.0.1:3107` is the Eaon host. Or,
 * outside production only, visit any page with `?host=tokns` to make this
 * browser the Eaon host until `?host=tokn`.
 */

const SITE_HEADER = "x-tokn-site";
const OVERRIDE_COOKIE = "tokn-dev-host";

const EAON_HOSTS = (process.env.TOKN_EAON_HOSTS ?? "tokns.eaon.dev")
  .split(",")
  .map((host) => host.trim().toLowerCase())
  .filter(Boolean);

const TOKN_URL = (process.env.TOKN_PUBLIC_URL ?? "https://toknhq.com").replace(/\/+$/, "");
const EAON_URL = (process.env.TOKN_EAON_URL ?? "https://tokns.eaon.dev").replace(/\/+$/, "");

/** Paths the Eaon host serves as-is: the API, Next's assets, and static files. */
function passesThrough(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/.well-known/") ||
    pathname.startsWith("/apps/") ||
    // A file: favicon.ico, icon.svg, opengraph-image.png…
    /\/[^/]+\.[a-z0-9]+$/i.test(pathname)
  );
}

const HANDLE = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,23}$/;

export function middleware(request: NextRequest) {
  const url = request.nextUrl;
  const host = (request.headers.get("host") ?? "").toLowerCase();
  const hostname = host.replace(/:\d+$/, "");

  let eaon = EAON_HOSTS.includes(host) || EAON_HOSTS.includes(hostname);
  let override: "set" | "clear" | null = null;

  if (process.env.NODE_ENV !== "production") {
    const requested = url.searchParams.get("host");
    if (requested === "tokns") {
      eaon = true;
      override = "set";
    } else if (requested === "tokn") {
      eaon = false;
      override = "clear";
    } else if (request.cookies.get(OVERRIDE_COOKIE)?.value === "eaon") {
      eaon = true;
    }
  }
  // An override is a browser pretending to be on the other host. Sign-in and
  // the rest still live on this same origin, so they are not sent anywhere.
  const pretending = eaon && !EAON_HOSTS.includes(host) && !EAON_HOSTS.includes(hostname);

  const headers = new Headers(request.headers);
  headers.delete(SITE_HEADER);

  const finish = (response: NextResponse) => {
    if (override === "set") {
      response.cookies.set(OVERRIDE_COOKIE, "eaon", { path: "/", sameSite: "lax", httpOnly: true });
    }
    if (override === "clear") response.cookies.delete(OVERRIDE_COOKIE);
    return response;
  };

  if (!eaon) {
    // The Eaon pages have a design of their own and live on their own host.
    // In production, their internal addresses here send people there; in
    // development they still render on this host, for working on them.
    const internal = /^\/eaon(?:\/([^/]+))?\/?$/.exec(url.pathname);
    if (internal && process.env.NODE_ENV === "production") {
      const target = new URL(internal[1] ? `/@${internal[1]}` : "/", EAON_URL);
      target.search = url.search;
      return finish(NextResponse.redirect(target, 308));
    }
    return finish(NextResponse.next({ request: { headers } }));
  }

  const pathname = url.pathname;
  const rewrite = (to: string) => {
    headers.set(SITE_HEADER, "eaon");
    const target = url.clone();
    target.pathname = to;
    target.searchParams.delete("host");
    return finish(NextResponse.rewrite(target, { request: { headers } }));
  };

  if (pathname === "/") return rewrite("/eaon");

  // `/@handle`. Some clients send the @ encoded.
  const at = /^\/(?:@|%40)([^/]+)\/?$/i.exec(pathname);
  if (at) {
    let handle: string;
    try {
      handle = decodeURIComponent(at[1]!);
    } catch {
      handle = "";
    }
    // Anything that cannot be a handle still renders, as the profile's own
    // not-found page, rather than leaking into the rest of the site.
    return rewrite(`/eaon/${HANDLE.test(handle) ? handle : "-"}`);
  }

  // The internal paths have short public forms here; send them there, so one
  // page has one address.
  if (pathname === "/eaon" || pathname === "/eaon/") {
    const target = url.clone();
    target.pathname = "/";
    return finish(NextResponse.redirect(target, 308));
  }
  const internal = /^\/eaon\/([^/]+)\/?$/.exec(pathname);
  if (internal) {
    const target = url.clone();
    target.pathname = `/@${internal[1]}`;
    return finish(NextResponse.redirect(target, 308));
  }

  if (passesThrough(pathname) || pretending) {
    return finish(NextResponse.next({ request: { headers } }));
  }

  // Sign-in, consent, account pages, the main board: all on toknhq.com.
  const target = new URL(`${pathname}${url.search}`, TOKN_URL);
  return finish(NextResponse.redirect(target, 307));
}

export const config = {
  // Not Next's own build output, which never needs a host decision.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
