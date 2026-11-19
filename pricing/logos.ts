/**
 * Dynamic models.dev catalog logo builders and fetch helpers.
 * Re-exports browser-safe primitives from `logos-core.ts`.
 */

import { CATALOG_URL, fetchCatalogIfChanged, type ModelsDevCatalog } from "./catalog.ts";
import {
  extractModelVendor,
  inferLabFromModelName,
  normalizeLabId,
  RESELLER_PROVIDERS,
  sanitizeLogoSvg,
  type LogoCatalogMap,
  type LogoSvg,
} from "./logos-core.ts";
import { normalizeModelId } from "./normalize.ts";

export * from "./logos-core.ts";

export type ModelsDevModelsIndex = Record<
  string,
  {
    id?: string;
    name?: string;
    family?: string;
  }
>;

export const MODELS_INDEX_URL = "https://models.dev/models.json";
export const LAB_LOGO_BASE_URL = "https://models.dev/logos/labs";
export const PROVIDER_LOGO_BASE_URL = "https://models.dev/logos";

const AMBIGUOUS_MODEL_IDS = new Set([
  "auto",
  "default",
  "free",
  "best",
  "fast",
  "reasoning",
  "coding",
]);

/**
 * Build compact `modelLabs` and `familyLabs` lookup tables from models.dev catalogs.
 * Records only models whose lab is unambiguous and not redundant with `inferLabFromModelName`.
 */
export function buildLogoCatalogMap(
  apiCatalog: ModelsDevCatalog,
  modelsIndex?: ModelsDevModelsIndex,
): LogoCatalogMap {
  const modelLabs: Record<string, string> = {};
  const familyLabCounts = new Map<string, Map<string, number>>();

  const recordFamily = (family: string | undefined, lab: string) => {
    if (!family) return;
    const f = family.trim().toLowerCase();
    if (!f) return;
    let counts = familyLabCounts.get(f);
    if (!counts) {
      counts = new Map();
      familyLabCounts.set(f, counts);
    }
    counts.set(lab, (counts.get(lab) ?? 0) + 1);
  };

  if (modelsIndex) {
    for (const [key, entry] of Object.entries(modelsIndex)) {
      const slash = key.indexOf("/");
      if (slash <= 0) continue;
      const lab = normalizeLabId(key.slice(0, slash));
      if (!lab) continue;
      const modelId = key.slice(slash + 1).trim().toLowerCase();
      if (!modelId || AMBIGUOUS_MODEL_IDS.has(modelId)) continue;
      const norm = normalizeModelId(modelId);
      recordFamily(entry?.family, lab);

      // Skip entries already handled deterministically by inferLabFromModelName.
      if (inferLabFromModelName(modelId) === lab && inferLabFromModelName(norm) === lab) continue;
      modelLabs[modelId] ??= lab;
      if (norm && !AMBIGUOUS_MODEL_IDS.has(norm)) modelLabs[norm] ??= lab;
    }
  }

  // Detect multi-lab resellers in api.json (hosts serving models from other creator labs)
  // so aggregators like digitalocean, sap-ai-core, or edenai never overwrite creator ownership.
  const multiLabProviders = new Set<string>();
  for (const [providerId, provider] of Object.entries(apiCatalog)) {
    const providerLab = normalizeLabId(providerId);
    for (const rawId of Object.keys(provider?.models ?? {})) {
      const bare = extractModelVendor(rawId).bareModel;
      const norm = normalizeModelId(bare);
      const owner =
        extractModelVendor(rawId).creator ??
        inferLabFromModelName(rawId) ??
        modelLabs[bare] ??
        modelLabs[norm];
      if (owner && owner !== providerLab) {
        multiLabProviders.add(providerId);
        break;
      }
    }
  }

  for (const [providerId, provider] of Object.entries(apiCatalog)) {
    const providerLab = normalizeLabId(providerId);
    const isAggregator = !providerLab || RESELLER_PROVIDERS.has(providerLab) || multiLabProviders.has(providerId);
    for (const [rawId, model] of Object.entries(provider?.models ?? {})) {
      const { creator, bareModel: bare } = extractModelVendor(rawId);
      if (!bare || AMBIGUOUS_MODEL_IDS.has(bare)) continue;
      const norm = normalizeModelId(bare);
      const existingLab =
        creator ??
        inferLabFromModelName(rawId) ??
        modelLabs[bare] ??
        modelLabs[norm];
      const effectiveLab = existingLab ?? (!isAggregator ? providerLab : null);
      if (!effectiveLab) continue;
      recordFamily((model as { family?: string } | undefined)?.family, effectiveLab);
      if (!existingLab && !isAggregator && providerLab) {
        modelLabs[bare] ??= providerLab;
        if (norm && !AMBIGUOUS_MODEL_IDS.has(norm)) modelLabs[norm] ??= providerLab;
      }
    }
  }

  const familyLabs: Record<string, string> = {};
  for (const [family, counts] of familyLabCounts) {
    // Only record families with a single dominant creator lab that aren't already in MODEL_PREFIX_RULES.
    if (inferLabFromModelName(family)) continue;
    let bestLab = "";
    let bestCount = 0;
    let total = 0;
    for (const [lab, count] of counts) {
      total += count;
      if (count > bestCount) {
        bestCount = count;
        bestLab = lab;
      }
    }
    if (bestLab && bestCount / total >= 0.7) {
      familyLabs[family] = bestLab;
    }
  }

  return { modelLabs, familyLabs };
}

/** Collect bare/normalized model ID -> family strings across models.dev catalogs. */
export function collectCatalogFamilies(
  apiCatalog: ModelsDevCatalog | null,
  modelsIndex?: ModelsDevModelsIndex | null,
): Record<string, string> {
  const families: Record<string, string> = {};
  if (modelsIndex) {
    for (const [key, entry] of Object.entries(modelsIndex)) {
      if (!entry?.family) continue;
      const slash = key.indexOf("/");
      const bare = slash > 0 ? key.slice(slash + 1).toLowerCase() : key.toLowerCase();
      if (!bare) continue;
      families[bare] ??= entry.family;
      const norm = normalizeModelId(bare);
      if (norm) families[norm] ??= entry.family;
    }
  }
  if (apiCatalog) {
    for (const provider of Object.values(apiCatalog)) {
      for (const [rawId, rawModel] of Object.entries(provider?.models ?? {})) {
        const family = (rawModel as { family?: string } | undefined)?.family;
        if (!family) continue;
        const bare = extractModelVendor(rawId).bareModel;
        if (!bare) continue;
        families[bare] ??= family;
        const norm = normalizeModelId(bare);
        if (norm) families[norm] ??= family;
      }
    }
  }
  return families;
}

export interface FetchJsonResult<T> {
  data: T;
  etag: string | null;
}

/** Conditional GET against models.dev/models.json honoring ETag/304. */
export async function fetchModelsIndexIfChanged(
  etag: string | null,
  options: { url?: string; timeoutMs?: number } = {},
): Promise<FetchJsonResult<ModelsDevModelsIndex> | null> {
  const url = options.url ?? MODELS_INDEX_URL;
  const timeoutMs = options.timeoutMs ?? 8_000;
  const headers: Record<string, string> = {};
  if (etag) headers["If-None-Match"] = etag;
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (res.status === 304) return null;
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return {
    data: (await res.json()) as ModelsDevModelsIndex,
    etag: res.headers.get("etag"),
  };
}

/** Conditional fetch of both models.dev/api.json and models.dev/models.json. */
export async function fetchLogoCatalogsIfChanged(
  etags: { api: string | null; models: string | null },
  options: { apiUrl?: string; modelsUrl?: string; timeoutMs?: number } = {},
): Promise<{
  changed: boolean;
  api: ModelsDevCatalog | null;
  models: ModelsDevModelsIndex | null;
  etags: { api: string | null; models: string | null };
}> {
  const [apiRes, modelsRes] = await Promise.all([
    fetchCatalogIfChanged(etags.api, { url: options.apiUrl ?? CATALOG_URL, timeoutMs: options.timeoutMs }),
    fetchModelsIndexIfChanged(etags.models, { url: options.modelsUrl, timeoutMs: options.timeoutMs }),
  ]);
  return {
    changed: apiRes !== null || modelsRes !== null,
    api: apiRes?.catalog ?? null,
    models: modelsRes?.data ?? null,
    etags: {
      api: apiRes ? apiRes.etag : etags.api,
      models: modelsRes ? modelsRes.etag : etags.models,
    },
  };
}

/**
 * Fetch and sanitize a monochrome SVG for a lab/provider ID from models.dev.
 * Checks `/logos/labs/{id}.svg` first, then `/logos/{id}.svg`.
 */
export async function fetchLabLogoSvg(
  id: string,
  options: { timeoutMs?: number; defaultSparkleSvg?: string | null; fetcher?: typeof fetch } = {},
): Promise<LogoSvg | null> {
  const clean = normalizeLabId(id);
  if (!clean) return null;
  const doFetch = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;

  for (const url of [`${LAB_LOGO_BASE_URL}/${clean}.svg`, `${PROVIDER_LOGO_BASE_URL}/${clean}.svg`]) {
    try {
      const res = await doFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) continue;
      const text = await res.text();
      const sanitized = sanitizeLogoSvg(text, options.defaultSparkleSvg);
      if (sanitized) return sanitized;
    } catch {
      // Try next candidate URL or return null cleanly.
    }
  }
  return null;
}
