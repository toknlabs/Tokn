import {
  buildPriceTable,
  fetchCatalog,
  fetchCatalogIfChanged,
  loadOverrides,
  normalizeModelId,
  type PriceDraft,
} from "../../pricing/catalog.ts";
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

/* -------------------------------------------------- models nobody has priced */

/**
 * How often one server instance may ask models.dev about unpriced models.
 *
 * Some models are never in the catalog (local models, internal Codex review
 * models), and they turn up in syncs all day. Asking costs a 304 while the
 * catalog is unchanged, but a sync should not wait on even that every time.
 */
const LOOK_GAP_MS = 10 * 60 * 1000;

function pricedBy(table: Record<string, unknown>, model: string): boolean {
  // The same lookup `assess` prices with.
  return Object.hasOwn(table, model) || Object.hasOwn(table, normalizeModelId(model));
}

/** What a lookup reads and writes, passed in so its decisions can be tested without a network. */
export interface ModelLookupIO {
  fetchCatalog: typeof fetchCatalogIfChanged;
  table: () => Promise<Record<string, unknown>>;
  write: (rows: PriceRow[]) => Promise<number>;
  /** A full refresh already running, which may be about to price them. */
  refreshing: () => Promise<unknown> | null;
  now: () => number;
}

/**
 * Price models the table has never seen, as soon as models.dev lists them.
 *
 * The daily cron alone left a model released at 07:00 unpriced until the next
 * morning, and every sync that used it in between had those rows refused. A
 * sync that meets an unpriced model calls this first. If the catalog has
 * changed and now prices one of them, the whole table is rebuilt the same way
 * the cron does it.
 *
 * The returned function gives back the models that are priced now. It never
 * throws: if models.dev is down, the sync goes ahead and those rows are
 * refused exactly as before.
 */
export function modelLookup(io: ModelLookupIO): (models: string[]) => Promise<string[]> {
  /** The catalog version last read. A 304 against it means nothing is new. */
  let catalogEtag: string | null = null;
  let lastLookAt = -Infinity;
  /** Kept apart from the cron's `inFlight`: a look that finds nothing must not stand in for a full refresh. */
  let looking: Promise<void> | null = null;

  async function look(models: string[]): Promise<void> {
    const fetched = await io.fetchCatalog(catalogEtag);
    if (!fetched) return;

    const drafts = buildPriceTable(fetched.catalog, loadOverrides());
    const ids = Object.fromEntries(drafts.map((draft) => [draft.modelId, true]));
    // Rebuild only for a catalog that prices one of them. Either way this
    // version has now been read, so the next look is a 304 until models.dev
    // publishes something new.
    if (models.some((model) => pricedBy(ids, model))) await io.write(drafts.map(toRow));
    catalogEtag = fetched.etag;
  }

  return async (models) => {
    if (models.length === 0) return [];

    try {
      const refreshing = io.refreshing();
      if (refreshing) {
        await refreshing;
      } else if (looking) {
        await looking;
      } else if (io.now() - lastLookAt >= LOOK_GAP_MS) {
        lastLookAt = io.now();
        looking = look(models).finally(() => {
          looking = null;
        });
        await looking;
      }

      const table = await io.table();
      return models.filter((model) => pricedBy(table, model));
    } catch (error) {
      console.error(`pricing lookup failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  };
}

/** One per server instance. `upsertPrices` drops the memoised table itself. */
export const priceNewModels = modelLookup({
  fetchCatalog: fetchCatalogIfChanged,
  table: pricingTable,
  write: upsertPrices,
  refreshing: () => inFlight,
  now: Date.now,
});

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
