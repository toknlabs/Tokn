import { NextResponse } from "next/server";
import { authorizeUrl, createState, githubEnabled, safeReturnPath } from "@/lib/backend";
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

  const next = new URL(request.url).searchParams.get("next") ?? undefined;
  const user = await currentUser();

  // Only same-origin paths, so `next` cannot be used as an open redirect.
  const safeNext = safeReturnPath(next) ?? undefined;

  const state = createState({ link: user?.id, next: safeNext });
  return NextResponse.redirect(authorizeUrl(state));
}
