import fs from "node:fs";
import overridesJson from "./overrides.json" with { type: "json" };

/**
 * One builder for every price table tokn serves.
 *
 * The CLI offline catalog, the Appwrite seed, and the server refresh all call
 * `buildPriceTable` on the models.dev catalog. Provider order, id
 * normalisation, and the override file live here so those three cannot drift.
 *
 * Rates are US dollars per million tokens. models.dev publishes one
 * `cache_write` figure, which is the 5-minute rate. Anthropic's 1-hour tier
 * and fast mode are not in that catalog; they are patched from
 * `overrides.json`.
 */

export const CATALOG_URL = "https://models.dev/api.json";

/**
 * First-party providers win over resellers. They are applied first; a later
 * provider never overwrites an id that is already set. Providers absent from
 * this list are not priced — reseller catalogs restate the same models at
 * different markups, and letting them in would move rates we already trust.
 */
export const PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "google-vertex",
  "xai",
  "deepseek",
  "mistral",
  "meta",
  "alibaba",
  "moonshotai",
  "zhipuai",
  "minimax",
  "inception",
  "cohere",
  "amazon-bedrock",
  "azure",
  "github-copilot",
  "groq",
  "cerebras",
  "fireworks-ai",
  "together",
  "deepinfra",
  "perplexity",
  "openrouter",
  "vercel",
  "opencode",
] as const;

/** Fields the catalog cannot express, keyed by normalised model id. */
export interface PriceOverride {
  input?: number;
  output?: number;
  cacheRead?: number | null;
  cacheWrite?: number | null;
  cacheWrite1h?: number | null;
  fastInput?: number | null;
  fastOutput?: number | null;
}

export interface CatalogModel {
  cost?: {
    input?: number;
    output?: number;
    cache_read?: number;
    cache_write?: number;
  };
}

export interface ModelsDevCatalog {
  [provider: string]: { models?: Record<string, CatalogModel> } | undefined;
}

/** A row ready to store or to render into the CLI catalog. */
export interface PriceDraft {
  modelId: string;
  provider: string;
  input: number;
  output: number;
  cacheRead: number | null;
  cacheWrite: number | null;
  cacheWrite1h: number | null;
  fastInput: number | null;
  fastOutput: number | null;
}

/**
 * The override table.
 *
 * Imported rather than read from disk. The cron and the pricing route run as
 * bundled Next.js server functions, where `import.meta.url` points inside
 * `.next/server` and a sibling `overrides.json` is not in the bundle. A static
 * import is inlined by the bundler and still loads under `node --experimental-strip-types`.
 * Pass `file` only to read a different copy in a test.
 */
export function loadOverrides(file?: string): Record<string, PriceOverride> {
  if (!file) return overridesJson;
  return JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, PriceOverride>;
}

/**
 * Reduce a model identifier to the form stored in the catalog.
 *
 * Real logs carry provider prefixes, Bedrock region prefixes, Vertex
 * `@`-versions and dated snapshots. `openai/gpt-6-luna` and
 * `gpt-6-luna-20260922` price as `gpt-6-luna`. A leading `~` is kept, so an
 * alias such as `~openai/gpt-luna-latest` stays its own row instead of being
 * mistaken for the vendor prefix `openai/`.
 */
export function normalizeModelId(raw: string): string {
  let id = raw.trim().toLowerCase();

  id = id.replace(/^(us|eu|apac|global|ca|sa|apne|usgov)\./, "");
  id = id.replace(/^anthropic\./, "");
  id = id.replace(/^[a-z0-9-]+\//, "");
  id = id.replace(/-v\d+(?::\d+)?$/, "");

  const at = id.indexOf("@");
  if (at !== -1) id = id.slice(0, at);

  id = id.replace(/-\d{8}$/, "");
  return id;
}

function applyOverride(row: PriceDraft, override: PriceOverride | undefined): PriceDraft {
  if (!override) return row;
  return {
    ...row,
    input: override.input ?? row.input,
    output: override.output ?? row.output,
    cacheRead: override.cacheRead !== undefined ? override.cacheRead : row.cacheRead,
    cacheWrite: override.cacheWrite !== undefined ? override.cacheWrite : row.cacheWrite,
    cacheWrite1h: override.cacheWrite1h !== undefined ? override.cacheWrite1h : row.cacheWrite1h,
    fastInput: override.fastInput !== undefined ? override.fastInput : row.fastInput,
    fastOutput: override.fastOutput !== undefined ? override.fastOutput : row.fastOutput,
  };
}

/**
 * Build the price table from a models.dev catalog document.
 *
 * Free and local models (both rates zero) are skipped: there is nothing to
 * bill. The first provider in `providers` to claim an id wins.
 */
export function buildPriceTable(
  catalog: ModelsDevCatalog,
  overrides: Record<string, PriceOverride> = loadOverrides(),
  providers: readonly string[] = PROVIDERS,
): PriceDraft[] {
  const seen = new Map<string, PriceDraft>();

  for (const provider of providers) {
    const models = catalog[provider]?.models;
    if (!models) continue;

    for (const [id, model] of Object.entries(models)) {
      const cost = model.cost;
      if (!cost || typeof cost.input !== "number" || typeof cost.output !== "number") continue;
      if (cost.input === 0 && cost.output === 0) continue;

      const key = normalizeModelId(id);
      if (seen.has(key)) continue;

      seen.set(
        key,
        applyOverride(
          {
            modelId: key,
            provider,
            input: cost.input,
            output: cost.output,
            cacheRead: typeof cost.cache_read === "number" ? cost.cache_read : null,
            cacheWrite: typeof cost.cache_write === "number" ? cost.cache_write : null,
            cacheWrite1h: null,
            fastInput: null,
            fastOutput: null,
          },
          overrides[key],
        ),
      );
    }
  }

  for (const [key, override] of Object.entries(overrides)) {
    if (seen.has(key)) continue;
    if (typeof override.input !== "number" || typeof override.output !== "number") continue;
    seen.set(
      key,
      applyOverride(
        {
          modelId: key,
          provider: "override",
          input: override.input,
          output: override.output,
          cacheRead: null,
          cacheWrite: null,
          cacheWrite1h: null,
          fastInput: null,
          fastOutput: null,
        },
        override,
      ),
    );
  }

  return [...seen.values()].sort((a, b) => a.modelId.localeCompare(b.modelId));
}

export function providersUsed(catalog: ModelsDevCatalog, providers: readonly string[] = PROVIDERS): number {
  return providers.filter((provider) => catalog[provider]?.models).length;
}

/** Tuple layout consumed by the CLI: `[input, output, cacheRead?, cacheWrite?]`. */
export function cliTuple(row: PriceDraft): number[] {
  const tuple = [row.input, row.output];
  if (row.cacheRead !== null || row.cacheWrite !== null) {
    tuple.push(row.cacheRead ?? 0);
    if (row.cacheWrite !== null) tuple.push(row.cacheWrite);
  }
  return tuple;
}

const CACHE = process.env.TOKN_CATALOG_CACHE ?? "/tmp/modelsdev.json";

/** Fetch the live catalog, falling back to the last copy on disk. */
export async function fetchCatalog(url = CATALOG_URL): Promise<ModelsDevCatalog> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const text = await response.text();
    fs.writeFileSync(CACHE, text);
    return JSON.parse(text) as ModelsDevCatalog;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`fetch failed (${message}); using cached ${CACHE}`);
    return JSON.parse(fs.readFileSync(CACHE, "utf8")) as ModelsDevCatalog;
  }
}
