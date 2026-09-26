import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { refreshPricingFromCatalog } from "@/lib/backend";

/**
 * GET /api/cron/refresh-pricing — rebuild the Appwrite price table.
 *
 * Vercel Cron calls this on the schedule in `vercel.json`. It runs the same
 * builder as `npm run seed:pricing`, so a model models.dev has started listing
 * is stored without anyone editing a rate. Set `CRON_SECRET` in the project
 * environment; Vercel sends it as `Authorization: Bearer <secret>`.
 */

export const dynamic = "force-dynamic";

function authorized(request: Request, secret: string): boolean {
  const header = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const left = Buffer.from(header);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !authorized(request, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await refreshPricingFromCatalog({ force: true });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "pricing refresh failed";
    console.error(message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
