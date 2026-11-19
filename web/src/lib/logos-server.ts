/**
 * Server-only dynamic model logo resolution with Next.js data-cache integration.
 */

import "server-only";
import { unstable_cache } from "next/cache";
import { renderSvgDocument } from "../../../pricing/logos-core.ts";
import { getDynamicModelLogoSvg, resolveDynamicModelLogos } from "@/lib/backend";
import { BUNDLED_MODEL_LOGOS, BUNDLED_TOOL_LOGOS } from "./logo-catalog.generated";
import {
  resolveStaticModelLogo,
  STATIC_LOGO_IDS,
  STATIC_LOGO_MAP,
  type LogoMap,
  type LogoSvg,
} from "./logos";

export { renderSvgDocument };

const resolveUnknownModelsCached = unstable_cache(
  async (modelsKey: string): Promise<LogoMap> => {
    const models = modelsKey.split("\n").filter(Boolean);
    return resolveDynamicModelLogos(models, {
      staticMap: STATIC_LOGO_MAP,
      knownStaticLogos: STATIC_LOGO_IDS,
    });
  },
  ["dynamic-model-logos"],
  { revalidate: 86_400, tags: ["model-logos"] },
);

/**
 * Resolve logo metadata for all displayed model IDs on a page or API response.
 * Models covered by bundled creator rules resolve synchronously with zero DB/network overhead.
 */
export async function resolveModelLogos(models: Iterable<string | null | undefined>): Promise<LogoMap> {
  const out: LogoMap = {};
  const unknown: string[] = [];

  for (const raw of models) {
    const model = raw?.trim();
    if (!model || model in out) continue;
    const staticHit = resolveStaticModelLogo(model);
    if (staticHit) {
      out[model] = staticHit;
    } else {
      unknown.push(model);
    }
  }

  if (unknown.length === 0) return out;

  const uniqueUnknown = [...new Set(unknown)].sort();
  const dynamicHits = await resolveUnknownModelsCached(uniqueUnknown.join("\n"));
  for (const model of uniqueUnknown) {
    if (dynamicHits[model]) {
      out[model] = dynamicHits[model];
    }
  }

  return out;
}

/** Resolve an SVG for `/api/logos/[kind]/[id]`, preferring bundled icons before fetching models.dev. */
export async function getLogoSvgForApi(kind: "model" | "tool", id: string): Promise<LogoSvg | null> {
  if (kind === "tool") {
    return BUNDLED_TOOL_LOGOS[id] ?? null;
  }
  const bundled = BUNDLED_MODEL_LOGOS[id];
  if (bundled) return bundled;
  return getDynamicModelLogoSvg(id);
}
