import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import {
  ENV,
  approveAuthorization,
  authorizePath,
  authorizeRequest,
  denyAuthorization,
  isSameOrigin,
  oauthParamsFromBody,
  oauthSigningKey,
} from "@/lib/backend";

/**
 * POST /api/oauth/authorize — the consent screen's approve and deny.
 *
 * Nothing from the page is trusted. The form's fields are run back through
 * `authorizeRequest`, the same function that decided what the page showed, so
 * a field edited in devtools gets exactly the answer the URL would have.
 *
 * Three checks before anything is signed:
 *
 *   Origin   must be this site. The session cookie rides along on the post, so
 *            a copy of this form on another site would otherwise approve on
 *            someone's behalf.
 *   request  re-validated; a broken one is refused here and never redirected.
 *   session  required. One that lapsed while the page sat open goes through
 *            sign-in and comes back to the same consent screen.
 *
 * Answers with 303, so the browser follows to the app's loopback with a GET.
 */

export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" };

function refuse(status: number, error: string, description: string) {
  return NextResponse.json({ error, error_description: description }, { status, headers: NO_STORE });
}

function seeOther(location: string) {
  return new NextResponse(null, { status: 303, headers: { location, ...NO_STORE } });
}

export async function POST(request: Request) {
  if (!isSameOrigin(request.headers.get("origin"), [request.url, ENV.publicUrl])) {
    return refuse(403, "access_denied", "this form can only be submitted from tokn itself");
  }

  const params = oauthParamsFromBody(request.headers.get("content-type"), await request.text());
  if (!params) return refuse(400, "invalid_request", "the form could not be read");

  const outcome = authorizeRequest(params);
  if (outcome.kind === "invalid") return refuse(400, "invalid_request", outcome.description);
  if (outcome.kind === "redirect") return seeOther(outcome.location);

  const user = await currentUser();
  if (!user) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", authorizePath(params));
    return seeOther(login.href);
  }

  const decision = params.getAll("decision");
  if (decision.length === 1 && decision[0] === "approve") {
    return seeOther(approveAuthorization(outcome.request, user.id, oauthSigningKey()));
  }
  if (decision.length === 1 && decision[0] === "deny") {
    return seeOther(denyAuthorization(outcome.request));
  }

  return refuse(400, "invalid_request", "decision must be approve or deny");
}
