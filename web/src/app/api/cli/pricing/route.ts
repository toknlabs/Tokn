import { after } from "next/server";
import { NextResponse } from "next/server";
import { pricingTableForCli, refreshPricingFromCatalog } from "@/lib/backend";

/**
 * GET /api/cli/pricing — the rate table the CLI prices a scan against.
 *
 * Unauthenticated on purpose: it is public information, and `tokn scan` works
 * before a machine is linked. The rows come from Appwrite. When that table is
 * older than a day, a refresh is scheduled after the response; an empty table
 * is filled before we answer. The daily cron does the same rebuild on a clock.
 */

export const revalidate = 3600;

export async function GET() {
  const { models, plan } = await pricingTableForCli();
  if (plan === "stale") {
    after(() =>
      refreshPricingFromCatalog().catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
      }),
    );
  }

  return NextResponse.json(
    { models, updatedAt: new Date().toISOString() },
    { headers: { "cache-control": "public, max-age=3600, stale-while-revalidate=86400" } },
  );
}
