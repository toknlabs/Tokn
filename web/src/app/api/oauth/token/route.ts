import { NextResponse } from "next/server";
import { oauthParamsFromBody, oauthToken } from "@/lib/backend";

/**
 * POST /api/oauth/token — trade an authorization code for an access token.
 *
 * Form-encoded per RFC 6749, JSON accepted as well. The token is an ordinary
 * device token, so it works with every `/api/cli/*` endpoint as it stands.
 * Every rule is in `backend/src/oauth/token.ts`; this only reads the body and
 * writes the reply.
 *
 * `no-store` on every answer, errors included: a token response must never be
 * held by a cache between here and the app (RFC 6749 §5.1).
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const params = oauthParamsFromBody(request.headers.get("content-type"), await request.text());
  const reply = await oauthToken(params);

  return NextResponse.json(reply.body, {
    status: reply.status,
    headers: { "cache-control": "no-store", pragma: "no-cache" },
  });
}
