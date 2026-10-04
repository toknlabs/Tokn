import { NextResponse } from "next/server";
import { authorizeUrl, createState, githubEnabled, requestUrl, safeReturnPath } from "@/lib/backend";
import { currentUser } from "@/lib/auth";

/**
 * GET /api/auth/github — start the GitHub sign-in flow.
 *
 * If somebody is already signed in, this connects GitHub to the account they
 * have rather than creating a second one. That intent travels in the signed
 * state so the callback cannot be tricked into switching accounts.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!githubEnabled()) {
    return NextResponse.json({ error: "GitHub sign-in is not configured" }, { status: 503 });
  }

  // As sent: `next` can carry an app's 127.0.0.1 redirect_uri, which
  // Next's normalised `request.url` would turn into localhost.
  const next = requestUrl(request).searchParams.get("next") ?? undefined;
  const user = await currentUser();

  // Only same-origin paths, so `next` cannot be used as an open redirect.
  const safeNext = safeReturnPath(next) ?? undefined;

  const state = createState({ link: user?.id, next: safeNext });
  return NextResponse.redirect(authorizeUrl(state));
}
