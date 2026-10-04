import { NextResponse } from "next/server";
import { oauthParamsFromBody, oauthRevoke } from "@/lib/backend";

/**
 * POST /api/oauth/revoke — RFC 7009 token revocation.
 *
 * What an app calls when someone signs out of it. The device row is revoked,
 * exactly as the button on `/account` does. The answer is 200 whether or not
 * the token matched anything, so this cannot be used to test which tokens are
 * live.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const params = oauthParamsFromBody(request.headers.get("content-type"), await request.text());
  const reply = await oauthRevoke(params);

  return NextResponse.json(reply.body, {
    status: reply.status,
    headers: { "cache-control": "no-store" },
  });
}
