/**
 * Runtime model logo resolver.
 *
 * Keeps page renders zero-overhead when every displayed model matches bundled creator rules,
 * and automatically learns new models + fetches/sanitizes new lab SVGs from models.dev when
 * unrecognized models appear. Uses conditional ETags and a 10-minute throttle so an unknown
 * local model ID cannot trigger a storm of models.dev requests.
 */

import { normalizeModelId, type ModelsDevCatalog } from "../../pricing/catalog.ts";
import {
  buildLogoCatalogMap,
  collectCatalogFamilies,
  extractModelVendor,
  fetchLabLogoSvg,
  fetchLogoCatalogsIfChanged,
  normalizeLabId,
  resolveModelLogoId,
  type LogoCatalogMap,
  type LogoSvg,
  type ModelsDevModelsIndex,
} from "../../pricing/logos.ts";
import { pricingProviders } from "./repo/pricing.ts";

export interface ResolvedModelLogo {
  id: string;
  /** Present when the SVG is dynamically fetched (not in the client's static bundle). */
  svg?: LogoSvg;
}

export interface LogoLookupIo {
  fetchCatalogs: (etags: { api: string | null; models: string | null }) => Promise<{
    changed: boolean;
    api: ModelsDevCatalog | null;
    models: ModelsDevModelsIndex | null;
    etags: { api: string | null; models: string | null };
  }>;
  fetchSvg: (id: string) => Promise<LogoSvg | null>;
  pricingProviders: () => Promise<Record<string, string>>;
  now?: () => number;
}

export interface ResolveLogosOptions {
  /** Bundled model/family lookup map so static knowledge skips catalog fetches. */
  staticMap?: LogoCatalogMap;
  /** Set of logo IDs already bundled into the client so SVGs aren't re-fetched or serialized. */
  knownStaticLogos?: ReadonlySet<string>;
}

const CATALOG_THROTTLE_MS = 10 * 60_000;
const SVG_TTL_MS = 24 * 60 * 60_000;
const SVG_MISS_TTL_MS = 30 * 60_000;

const defaultIo: LogoLookupIo = {
  fetchCatalogs: (etags) => fetchLogoCatalogsIfChanged(etags),
  fetchSvg: (id) => fetchLabLogoSvg(id),
  pricingProviders,
};

export function createLogoResolver(io: LogoLookupIo = defaultIo) {
  const getNow = () => (io.now ? io.now() : Date.now());

  let etags: { api: string | null; models: string | null } = { api: null, models: null };
  let lastApiCatalog: ModelsDevCatalog = {};
  let lastModelsIndex: ModelsDevModelsIndex = {};
  let liveMap: LogoCatalogMap = { modelLabs: {}, familyLabs: {} };
  let liveFamilies: Record<string, string> = {};
  let lastCatalogAttemptAt = -Infinity;
  let inflightCatalog: Promise<void> | null = null;

  const svgCache = new Map<string, { svg: LogoSvg | null; at: number }>();
  const inflightSvgs = new Map<string, Promise<LogoSvg | null>>();

  async function refreshCatalogIfAllowed(force = false): Promise<void> {
    if (inflightCatalog) return inflightCatalog;
    const now = getNow();
    if (!force && now - lastCatalogAttemptAt < CATALOG_THROTTLE_MS) return;

    inflightCatalog = (async () => {
      lastCatalogAttemptAt = getNow();
      try {
        const res = await io.fetchCatalogs(etags);
        etags = res.etags;
        if (!res.changed) return;
        if (res.api) lastApiCatalog = res.api;
        if (res.models) lastModelsIndex = res.models;
        liveMap = buildLogoCatalogMap(lastApiCatalog, lastModelsIndex);
        liveFamilies = collectCatalogFamilies(lastApiCatalog, lastModelsIndex);
      } catch {
        // Keep previously learned catalog state on transient network failure.
      } finally {
        inflightCatalog = null;
      }
    })();

    return inflightCatalog;
  }

  async function getLogoSvg(rawId: string): Promise<LogoSvg | null> {
    const id = normalizeLabId(rawId);
    if (!id) return null;

    const now = getNow();
    const cached = svgCache.get(id);
    if (cached) {
      const ttl = cached.svg ? SVG_TTL_MS : SVG_MISS_TTL_MS;
      if (now - cached.at < ttl) return cached.svg;
    }

    let pending = inflightSvgs.get(id);
    if (!pending) {
      pending = (async () => {
        try {
          const svg = await io.fetchSvg(id);
          svgCache.set(id, { svg, at: getNow() });
          return svg;
        } catch {
          svgCache.set(id, { svg: null, at: getNow() });
          return null;
        } finally {
          inflightSvgs.delete(id);
        }
      })();
      inflightSvgs.set(id, pending);
    }
    return pending;
  }

  function resolveLocally(
    model: string,
    staticMap: LogoCatalogMap | undefined,
    providers: Record<string, string>,
  ): string | null {
    const key = model.trim();
    const lower = key.toLowerCase();
    const { bareModel } = extractModelVendor(key);
    const norm = normalizeModelId(bareModel || lower);
    const mergedModelLabs =
      staticMap || Object.keys(liveMap.modelLabs).length > 0
        ? { ...staticMap?.modelLabs, ...liveMap.modelLabs }
        : undefined;
    const mergedFamilyLabs =
      staticMap || Object.keys(liveMap.familyLabs).length > 0
        ? { ...staticMap?.familyLabs, ...liveMap.familyLabs }
        : undefined;

    const family = liveFamilies[lower] ?? liveFamilies[bareModel] ?? liveFamilies[norm] ?? null;
    const provider = providers[key] ?? providers[lower] ?? providers[norm] ?? null;

    return resolveModelLogoId({
      model: key,
      modelLabs: mergedModelLabs,
      family,
      familyLabs: mergedFamilyLabs,
      provider,
    });
  }

  async function resolveModels(
    models: Iterable<string>,
    options: ResolveLogosOptions = {},
  ): Promise<Record<string, ResolvedModelLogo>> {
    const unique = [...new Set([...models].map((m) => m.trim()).filter(Boolean))];
    if (unique.length === 0) return {};

    const known = options.knownStaticLogos;
    const result: Record<string, ResolvedModelLogo> = {};
    const unresolvedOrDynamic: string[] = [];

    // Fast path: check pure static + already-warmed catalog state first without touching DB/network.
    for (const model of unique) {
      const id = resolveLocally(model, options.staticMap, {});
      if (id && (!known || known.has(id))) {
        result[model] = { id };
        continue;
      }
      const cachedSvg = id ? svgCache.get(id) : undefined;
      if (id && cachedSvg?.svg && getNow() - cachedSvg.at < SVG_TTL_MS) {
        result[model] = { id, svg: cachedSvg.svg };
        continue;
      }
      unresolvedOrDynamic.push(model);
    }

    if (unresolvedOrDynamic.length === 0) return result;

    // If any model lacks creator attribution even before reseller fallbacks, refresh
    // models.dev catalog (respecting the 10-minute throttle & ETag cache) first so a
    // reseller in the DB cannot hide a newly added creator lab.
    const needsCatalogRefresh = unresolvedOrDynamic.some(
      (model) => !resolveLocally(model, options.staticMap, {}),
    );
    if (needsCatalogRefresh) {
      await refreshCatalogIfAllowed(false);
    }

    // Only consult DB pricing providers if anything is still unattributed after models.dev.
    let providers: Record<string, string> = {};
    const stillUnattributed = unresolvedOrDynamic.some(
      (model) => !resolveLocally(model, options.staticMap, {}),
    );
    if (stillUnattributed) {
      try {
        providers = await io.pricingProviders();
      } catch {
        // Fixtures mode or unconfigured DB: continue cleanly.
      }
    }

    // Resolve all pending IDs and fetch dynamic SVGs when missing from the static bundle.
    const dynamicIdsNeeded = new Set<string>();
    const pendingIdByModel = new Map<string, string>();
    for (const model of unresolvedOrDynamic) {
      const id = resolveLocally(model, options.staticMap, providers);
      if (!id) continue;
      if (known && known.has(id)) {
        result[model] = { id };
      } else {
        pendingIdByModel.set(model, id);
        dynamicIdsNeeded.add(id);
      }
    }

    if (dynamicIdsNeeded.size > 0) {
      const fetched = new Map<string, LogoSvg | null>();
      await Promise.all(
        [...dynamicIdsNeeded].map(async (id) => {
          fetched.set(id, await getLogoSvg(id));
        }),
      );
      for (const [model, id] of pendingIdByModel) {
        const svg = fetched.get(id);
        if (svg) {
          result[model] = { id, svg };
        }
      }
    }

    return result;
  }

  function clearCache(): void {
    etags = { api: null, models: null };
    lastApiCatalog = {};
    lastModelsIndex = {};
    liveMap = { modelLabs: {}, familyLabs: {} };
    liveFamilies = {};
    lastCatalogAttemptAt = -Infinity;
    svgCache.clear();
  }

  return {
    resolveModels,
    getLogoSvg,
    refreshCatalogIfAllowed,
    clearCache,
  };
}

const defaultResolver = createLogoResolver();

export async function resolveDynamicModelLogos(
  models: Iterable<string>,
  options: ResolveLogosOptions = {},
): Promise<Record<string, ResolvedModelLogo>> {
  return defaultResolver.resolveModels(models, options);
}

export async function getDynamicModelLogoSvg(id: string): Promise<LogoSvg | null> {
  return defaultResolver.getLogoSvg(id);
}

export function clearLogoCache(): void {
  defaultResolver.clearCache();
}
