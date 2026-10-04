import { NextResponse } from "next/server";
import {
  exchangeCode,
  GithubError,
  safeReturnPath,
  signInWithGithub,
  verifyState,
} from "@/lib/backend";
import { createSession, setSessionCookie } from "@/lib/auth";
import { profilesChanged } from "@/lib/board-cache";

/**
 * GET /api/auth/github/callback — GitHub sends the user back here.
 *
 * Every failure redirects to /login with a readable message rather than
 * rendering JSON at the user: this URL is reached by a browser, not a client.
 */

export const dynamic = "force-dynamic";

function fail(request: Request, message: string) {
  const url = new URL("/login", new URL(request.url).origin);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;

  // The user pressed Cancel on GitHub's consent screen.
  const denied = params.get("error");
  if (denied) {
    return fail(request, denied === "access_denied" ? "GitHub sign-in was cancelled" : denied);
  }

  const code = params.get("code");
  if (!code) return fail(request, "GitHub did not send an authorization code");

  // Proves the flow started here, and carries whether this is a link or a
  // sign-in. An unsigned or stale state is refused.
  const state = verifyState(params.get("state") ?? undefined);
  if (!state) return fail(request, "that sign-in link expired — please try again");

  let result;
  try {
    const githubUser = await exchangeCode(code);
    result = await signInWithGithub(githubUser, state.link);
  } catch (error) {
    if (error instanceof GithubError) return fail(request, error.message);
    throw error;
  }

  if (!result.ok) return fail(request, result.error);
  // A new account joins the board straight away, at the bottom.
  if (result.created) profilesChanged();

  // Linking happens in an existing session; only a fresh sign-in needs a cookie.
  if (!state.link) {
    const session = await createSession(result.profile.$id);
    await setSessionCookie(session.id, session.expiresAt);
  }

  // `next` was checked before it was signed into the state; checked again here
  // so this redirect does not depend on every caller of createState having done so.
  const origin = new URL(request.url).origin;
  // A new account gets the welcome flow first, carrying where it was headed,
  // like an email sign-up does.
  const next = safeReturnPath(state.next);
  const destination = state.link
    ? "/settings?github=connected"
    : result.created
      ? next
        ? `/welcome?next=${encodeURIComponent(next)}`
        : "/welcome"
      : (next ?? "/account");

  return NextResponse.redirect(new URL(destination, origin));
}
