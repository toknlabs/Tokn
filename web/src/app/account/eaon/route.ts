import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth";
import { eaonProfileUrl } from "@/lib/sites";

/**
 * GET /account/eaon — "sign in with tokn" from the Eaon board.
 *
 * Sessions live only on toknhq.com, so the Eaon host cannot know who you are.
 * Its sign-in link comes here instead: signed in, you are sent to your Eaon
 * profile; not yet, you sign in first and come back through this same path.
 */

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login?next=/account/eaon", request.url));
  }
  return NextResponse.redirect(eaonProfileUrl(user.handle));
}
