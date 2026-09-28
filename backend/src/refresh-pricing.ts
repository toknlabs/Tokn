import { buildPriceTable, fetchCatalog, loadOverrides, type PriceDraft } from "../../pricing/catalog.ts";
import { clearPricingCache, pricingTable, pricingUpdatedAt, upsertPrices, type PriceRow } from "./repo/pricing.ts";

/**
 * Pull the models.dev catalog and upsert it into Appwrite.
 *
 * `npm run seed:pricing` and `GET /api/cron/refresh-pricing` both call this,
 * and the public pricing route schedules it when the stored table is older
 * than a day. Whatever models.dev lists — under a provider already in
 * `pricing/catalog.ts` — is priced on the next refresh. New rates that the
 * catalog cannot express belong in `pricing/overrides.json`, not in a
 * one-off model id.
 *
 * Re-runnable: rows are keyed by model id and overwritten.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const ATTEMPT_GAP_MS = 5 * 60 * 1000;

export interface RefreshResult {
  written: number;
  models: number;
  skipped?: string;
}

/** `empty` blocks the response; `stale` is safe to refresh after it. */
export type RefreshPlan = "empty" | "stale" | null;

let inFlight: Promise<RefreshResult> | null = null;
let lastAttemptAt = 0;

function toRow(draft: PriceDraft): PriceRow {
  return {
    modelId: draft.modelId,
    provider: draft.provider,
    input: draft.input,
    output: draft.output,
    cacheRead: draft.cacheRead,
    cacheWrite: draft.cacheWrite,
    cacheWrite1h: draft.cacheWrite1h,
    fastInput: draft.fastInput,
    fastOutput: draft.fastOutput,
  };
}

export async function refreshPricingFromCatalog(options: { force?: boolean } = {}): Promise<RefreshResult> {
  if (inFlight) return inFlight;
  if (!options.force && Date.now() - lastAttemptAt < ATTEMPT_GAP_MS) {
    return { written: 0, models: 0, skipped: "refreshed recently" };
  }

  lastAttemptAt = Date.now();
  inFlight = runRefresh().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function runRefresh(): Promise<RefreshResult> {
  const catalog = await fetchCatalog();
  const rows = buildPriceTable(catalog, loadOverrides()).map(toRow);
  const written = await upsertPrices(rows);
  clearPricingCache();
  return { written, models: rows.length };
}

/**
 * Decide from the age of the stored table, not from which model ids it holds.
 * An empty table is refreshed before we answer. A table older than a day is
 * still served, and the caller refreshes it in the background.
 */
export function pricingRefreshPlan(
  input: { count: number; updatedAt: string | null },
  now = Date.now(),
): RefreshPlan {
  if (input.count === 0) return "empty";
  if (!input.updatedAt) return "stale";
  const age = now - Date.parse(input.updatedAt);
  if (!Number.isFinite(age) || age > DAY_MS) return "stale";
  return null;
}

/** Table for `GET /api/cli/pricing`. Refreshes in-band only when nothing is stored. */
export async function pricingTableForCli(): Promise<{
  models: Awaited<ReturnType<typeof pricingTable>>;
  plan: RefreshPlan;
}> {
  const models = await pricingTable();
  const plan = pricingRefreshPlan({ count: Object.keys(models).length, updatedAt: pricingUpdatedAt() });
  if (plan !== "empty") return { models, plan };

  try {
    await refreshPricingFromCatalog({ force: true });
    return { models: await pricingTable(), plan: null };
  } catch (error) {
    console.error(
      `pricing refresh failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return { models, plan };
  }
}
