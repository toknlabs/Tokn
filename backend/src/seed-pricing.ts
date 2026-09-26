import { refreshPricingFromCatalog } from "./refresh-pricing.ts";
import { priceCount } from "./repo/pricing.ts";

/**
 * Load the model rate table into Appwrite.
 *
 *   npm run seed:pricing
 *
 * Thin wrapper around `refreshPricingFromCatalog`, which is also what the
 * daily cron calls. Both read `pricing/catalog.ts`, so the database and the
 * generated CLI catalog stay on the same builder.
 */

async function main(): Promise<void> {
  console.log("\n  refreshing prices from models.dev …");
  const result = await refreshPricingFromCatalog({ force: true });
  console.log(`\n  ${result.written} prices stored. Table now holds ${await priceCount()}.\n`);
}

main().catch((error: unknown) => {
  console.error(`\n  seeding failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
