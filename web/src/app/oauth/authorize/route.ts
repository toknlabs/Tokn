import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { authorizePath, authorizeRequest } from "@/lib/backend";

/**
 * GET /oauth/authorize — where "Sign in with tokn" starts.
 *
 * A desktop app opens this in the browser with a PKCE challenge and a loopback
 * redirect. It is a route rather than a page because every page on this site
 * streams behind the root `loading.tsx`, and a page that calls `redirect()`
 * after streaming has begun answers 200 with a meta refresh. An authorization
 * endpoint should answer with a real redirect, to the app or to sign-in, so
 * the decision is made here and only the screen itself is a page.
 *
 *   invalid   unknown app or a redirect URI it may not use: shown on the
 *             consent page, never redirected to
 *   error     anything else wrong: back to the app's loopback with the error
 *   signed out  to /login, which comes back here afterwards
 *   otherwise  to /oauth/consent, which checks it all again before rendering
 *
 * Validation comes before the sign-in check, so a broken link says so at once
 * rather than after someone has typed a password for it.
 */

export const dynamic = "force-dynamic";

function found(location: string, base: string) {
  return new NextResponse(null, {
    status: 302,
    headers: { location: new URL(location, base).href, "cache-control": "no-store" },
  });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const outcome = authorizeRequest(params);

  if (outcome.kind === "redirect") return found(outcome.location, request.url);
  if (outcome.kind === "invalid") return found(authorizePath(params, "/oauth/consent"), request.url);

  const user = await currentUser();
  if (!user) {
    return found(`/login?next=${encodeURIComponent(authorizePath(params))}`, request.url);
  }

  return found(authorizePath(params, "/oauth/consent"), request.url);
}
