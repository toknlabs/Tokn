import { CATALOG, CATALOG_GENERATED_AT, PRICING_OVERRIDES } from "./pricing-data.js";

/**
 * Model pricing and cost computation.
 *
 * All rates are US dollars per million tokens. The built-in table in
 * `pricing-data.ts` is generated from the models.dev catalog and covers every
 * major provider, not just Anthropic — tokn tracks several AI CLIs and each
 * speaks to different models.
 *
 * Cache pricing is the subtle part. Where a provider publishes explicit cache
 * rates we use them; otherwise we derive them from the input rate:
 *
 *   cache read                 = 0.10x input
 *   cache write, 5-minute TTL  = 1.25x input
 *   cache write, 1-hour TTL    = 2.00x input   (Anthropic only)
 *
 * The two cache-write TTLs must never be collapsed: a real Claude Code workload
 * is overwhelmingly 1h writes, so pricing them all at the 5m rate understates
 * the bill badly. No other provider currently exposes a 1h cache tier, so for
 * them that bucket is simply always zero.
 */

export interface ModelPrice {
  /** USD per million input tokens. */
  input: number;
  /** USD per million output tokens. */
  output: number;
  /** USD per million cache-read tokens. Defaults to 0.1x input. */
  cacheRead?: number;
  /** USD per million cache-write tokens (5-minute TTL). Defaults to 1.25x input. */
  cacheWrite?: number;
  /** USD per million cache-write tokens (1-hour TTL). Defaults to 2x input. */
  cacheWrite1h?: number;
  /** Premium rates when the request ran in fast mode. */
  fast?: { input: number; output: number };
}

export const CACHE_WRITE_5M_MULTIPLIER = 1.25;
export const CACHE_WRITE_1H_MULTIPLIER = 2.0;
export const DEFAULT_CACHE_READ_MULTIPLIER = 0.1;

export { CATALOG_GENERATED_AT };

/**
 * Patches the generated catalog cannot express (1-hour cache, fast mode).
 * Emitted from `pricing/overrides.json` by `npm run pricing`, so the CLI and
 * the server apply the same file.
 */
const OVERRIDES = PRICING_OVERRIDES;

function fromCatalog(id: string): ModelPrice | undefined {
  const row = CATALOG[id];
  if (!row) return undefined;

  const [input, output, cacheRead, cacheWrite] = row;
  if (typeof input !== "number" || typeof output !== "number") return undefined;

  const price: ModelPrice = { input, output };
  if (typeof cacheRead === "number" && cacheRead > 0) price.cacheRead = cacheRead;
  if (typeof cacheWrite === "number" && cacheWrite > 0) price.cacheWrite = cacheWrite;

  const override = OVERRIDES[id];
  return override ? { ...price, ...override } : price;
}

/**
 * Reduce a model identifier to its canonical form.
 *
 * Real data carries provider prefixes, Bedrock version suffixes, Vertex
 * `@`-versions and dated snapshots — `claude-haiku-4-5-20251001` shows up in
 * ordinary local data, and opencode records ids like `anthropic/claude-opus-5`.
 * All of those price identically to the base model.
 *
 * Kept in step with `normalizeModelId` in `pricing/catalog.ts`. The catalog
 * is built with that function, and lookup uses this one; they have to agree
 * or a prefixed log line misses a row the generator stored.
 */
export function normalizeModel(raw: string): string {
  let id = raw.trim().toLowerCase();

  id = id.replace(/^(us|eu|apac|global|ca|sa|apne|usgov)\./, "");
  id = id.replace(/^anthropic\./, "");
  id = id.replace(/^[a-z0-9-]+\//, ""); // "anthropic/claude-opus-5"
  id = id.replace(/-v\d+(?::\d+)?$/, "");

  const at = id.indexOf("@");
  if (at !== -1) id = id.slice(0, at);

  id = id.replace(/-\d{8}$/, "");
  return id;
}

/** Look up a model, trying the exact id then its normalised form. */
export function lookupPrice(
  model: string,
  pricing?: Record<string, ModelPrice>,
): ModelPrice | undefined {
  const id = normalizeModel(model);
  if (pricing) {
    const custom = pricing[id] ?? pricing[model];
    if (custom) return custom;
  }
  return fromCatalog(id);
}

/** Tokens the API billed us for, split by how each bucket is priced. */
export interface TokenCounts {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

export interface CostBreakdown {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  total: number;
}

export const ZERO_COST: CostBreakdown = {
  input: 0,
  output: 0,
  cacheWrite: 0,
  cacheRead: 0,
  total: 0,
};

const PER_MILLION = 1_000_000;

/**
 * Price one bucket of tokens.
 *
 * Returns `null` for a model we have no rate for, so the caller can report it
 * as unpriced rather than silently contributing $0 to a total presented as
 * authoritative.
 */
export function computeCost(
  model: string,
  tokens: TokenCounts,
  options: { fast?: boolean; pricing?: Record<string, ModelPrice> } = {},
): CostBreakdown | null {
  const price = lookupPrice(model, options.pricing);
  if (!price) return null;

  const rates = options.fast && price.fast ? price.fast : price;

  const readRate = price.cacheRead ?? price.input * DEFAULT_CACHE_READ_MULTIPLIER;
  const write5mRate = price.cacheWrite ?? price.input * CACHE_WRITE_5M_MULTIPLIER;
  const write1hRate = price.cacheWrite1h ?? price.input * CACHE_WRITE_1H_MULTIPLIER;

  const input = (tokens.input / PER_MILLION) * rates.input;
  const output = (tokens.output / PER_MILLION) * rates.output;
  const cacheWrite =
    (tokens.cacheWrite5m / PER_MILLION) * write5mRate +
    (tokens.cacheWrite1h / PER_MILLION) * write1hRate;
  const cacheRead = (tokens.cacheRead / PER_MILLION) * readRate;

  return {
    input,
    output,
    cacheWrite,
    cacheRead,
    total: input + output + cacheWrite + cacheRead,
  };
}

export function isKnownModel(model: string, pricing?: Record<string, ModelPrice>): boolean {
  return lookupPrice(model, pricing) !== undefined;
}

export function catalogSize(): number {
  return Object.keys(CATALOG).length;
}

export function addCost(a: CostBreakdown, b: CostBreakdown): CostBreakdown {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    cacheRead: a.cacheRead + b.cacheRead,
    total: a.total + b.total,
  };
}

export function emptyTokens(): TokenCounts {
  return { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0 };
}

export function addTokens(a: TokenCounts, b: TokenCounts): void {
  a.input += b.input;
  a.output += b.output;
  a.cacheWrite5m += b.cacheWrite5m;
  a.cacheWrite1h += b.cacheWrite1h;
  a.cacheRead += b.cacheRead;
}

export function totalTokens(t: TokenCounts): number {
  return t.input + t.output + t.cacheWrite5m + t.cacheWrite1h + t.cacheRead;
}
