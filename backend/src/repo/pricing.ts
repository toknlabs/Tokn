import { db, DB_ID, Query } from "../client.ts";
import { pricingRowId } from "../ids.ts";

/**
 * The rate table served to the CLI at `GET /api/cli/pricing`.
 *
 * Holding pricing server-side is what lets a model released after a CLI version
 * shipped still be priced correctly — the CLI treats whatever it fetches as
 * authoritative and falls back to its built-in catalog only when offline.
 *
 * Rates are USD per million tokens.
 */

export interface PriceRow {
  modelId: string;
  provider?: string | null;
  input: number;
  output: number;
  cacheRead?: number | null;
  cacheWrite?: number | null;
  /** Anthropic's 1-hour cache tier; no other provider exposes one. */
  cacheWrite1h?: number | null;
  fastInput?: number | null;
  fastOutput?: number | null;
}

/** The shape the CLI expects back. */
export interface CliPrice {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  cacheWrite1h?: number;
  fast?: { input: number; output: number };
}

export async function upsertPrices(rows: PriceRow[]): Promise<number> {
  if (rows.length === 0) return 0;
  const now = new Date().toISOString();
  const BATCH = 100;

  const documents = rows.map((row) => ({
    $id: pricingRowId(row.modelId),
    modelId: row.modelId.toLowerCase(),
    provider: row.provider ?? null,
    input: row.input,
    output: row.output,
    cacheRead: row.cacheRead ?? null,
    cacheWrite: row.cacheWrite ?? null,
    cacheWrite1h: row.cacheWrite1h ?? null,
    fastInput: row.fastInput ?? null,
    fastOutput: row.fastOutput ?? null,
    updatedAt: now,
  }));

  let written = 0;
  for (let i = 0; i < documents.length; i += BATCH) {
    const chunk = documents.slice(i, i + BATCH);
    await db().upsertDocuments(DB_ID, "pricing", chunk as never);
    written += chunk.length;
  }
  // New rows mean the memoised table is stale; drop it so the next
  // read sees what was just written rather than the last minute's prices.
  clearPricingCache();
  return written;
}

/**
 * In-flight and recently-resolved price table.
 *
 * A single profile render asks for this twice — once for the cost anatomy,
 * once for the what-if comparison — and each call was paging 702 models at a
 * hundred a time, so the page paid for eight sequential round trips, twice.
 *
 * Prices come from a generated catalogue and change when someone runs the
 * refresh, not between two awaits of the same request. Sharing the promise
 * collapses the duplicate work; the short expiry keeps a long-lived server
 * from pinning a stale table.
 */
let priceCache: { at: number; table: Promise<Record<string, CliPrice>> } | null = null;
const PRICE_TTL_MS = 60_000;

/** Newest `updatedAt` seen the last time the table was loaded from Appwrite. */
let newestUpdatedAt: string | null = null;

export function pricingUpdatedAt(): string | null {
  return newestUpdatedAt;
}

/** Every price, as the map the CLI consumes. */
export async function pricingTable(): Promise<Record<string, CliPrice>> {
  if (priceCache && Date.now() - priceCache.at < PRICE_TTL_MS) return priceCache.table;
  const table = loadPricingTable();
  priceCache = { at: Date.now(), table };
  // A failed load must not be cached, or one blip poisons the next minute.
  table.catch(() => {
    if (priceCache?.table === table) priceCache = null;
  });
  return table;
}

/** Drop the memo. Used after a pricing refresh writes new rows. */
export function clearPricingCache(): void {
  priceCache = null;
  newestUpdatedAt = null;
}

async function loadPricingTable(): Promise<Record<string, CliPrice>> {
  const out: Record<string, CliPrice> = {};
  let cursor: string | undefined;
  let newest: string | null = null;
  // 702 models at 100 a page is eight sequential round trips. Appwrite will
  // return the whole catalogue in one.
  const PAGE = 1000;

  for (;;) {
    const queries = [Query.limit(PAGE), Query.orderAsc("$id")];
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const page = await db().listDocuments(DB_ID, "pricing", queries);
    const docs = page.documents as unknown as (PriceRow & { $id: string; updatedAt?: string })[];

    for (const row of docs) {
      const price: CliPrice = { input: row.input, output: row.output };
      if (row.cacheRead != null) price.cacheRead = row.cacheRead;
      if (row.cacheWrite != null) price.cacheWrite = row.cacheWrite;
      if (row.cacheWrite1h != null) price.cacheWrite1h = row.cacheWrite1h;
      if (row.fastInput != null && row.fastOutput != null) {
        price.fast = { input: row.fastInput, output: row.fastOutput };
      }
      out[row.modelId] = price;
      const updatedAt = row.updatedAt;
      if (updatedAt && (newest === null || updatedAt > newest)) newest = updatedAt;
    }

    if (docs.length < PAGE) break;
    cursor = docs[docs.length - 1]?.$id;
    if (!cursor) break;
  }

  newestUpdatedAt = newest;
  return out;
}

export async function priceCount(): Promise<number> {
  const page = await db().listDocuments(DB_ID, "pricing", [Query.limit(1)]);
  return page.total;
}
