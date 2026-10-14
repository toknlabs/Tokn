import { NextResponse } from "next/server";
import { cliLinkCode } from "@/lib/backend";

/**
 * POST /api/cli/link-code — a link code for the tokn command, asked for by an
 * app that is signed in (`Authorization: Bearer <its token>`). Eaon Desktop
 * ships tokn and links it with this; see `cliLinkCode`.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const result = await cliLinkCode(request.headers.get("authorization"));

  if ("error" in result) {
    return NextResponse.json({ error: result.error, hint: result.hint }, { status: result.status });
  }

  return NextResponse.json(result);
}
