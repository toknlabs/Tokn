import { NextResponse } from "next/server";
import { oauthMetadata } from "@/lib/backend";

/**
 * GET /.well-known/oauth-authorization-server — RFC 8414 metadata.
 *
 * Lets an app discover the endpoints from the site's origin rather than carry
 * them hardcoded. The issuer is `TOKN_PUBLIC_URL`, so a preview deployment
 * advertises the production endpoints unless that variable says otherwise.
 */

export async function GET() {
  return NextResponse.json(oauthMetadata(), {
    headers: { "cache-control": "public, max-age=3600" },
  });
}
