/**
 * Fetch and bundle verified monochrome SVGs + lab mappings from models.dev and official tool sources
 * into `web/src/lib/logo-catalog.generated.ts`.
 *
 * Usage: node --experimental-strip-types pricing/gen-logos.ts
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { CATALOG_URL, type ModelsDevCatalog } from "./catalog.ts";
import {
  buildLogoCatalogMap,
  fetchLabLogoSvg,
  MODELS_INDEX_URL,
  PROVIDER_LOGO_BASE_URL,
  sanitizeLogoSvg,
  type LogoSvg,
  type ModelsDevModelsIndex,
} from "./logos.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_FILE = resolve(__dirname, "../web/src/lib/logo-catalog.generated.ts");

/** Labs missing custom SVG on models.dev that we supplement from verified monochrome icon packs. */
const SUPPLEMENTAL_LAB_URLS: Record<string, string> = {
  microsoft: "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/microsoft.svg",
  qwen: "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/qwen.svg",
};

/** Official monochrome tool SVGs bundled locally (zero runtime network requests for CLI tools). */
const TOOL_LOGO_URLS: Record<string, string> = {
  "claude-code": "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/claudecode.svg",
  "claude-desktop": "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/claude.svg",
  codex: "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/codex.svg",
  "copilot-cli": "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/githubcopilot.svg",
  opencode: `${PROVIDER_LOGO_BASE_URL}/opencode.svg`,
  cursor: "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/cursor.svg",
  "gemini-cli": "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/geminicli.svg",
  windsurf: "https://unpkg.com/@lobehub/icons-static-svg@latest/icons/windsurf.svg",
  orca: "https://raw.githubusercontent.com/stablyai/orca/main/resources/logo.svg",
};

/** Hand-crafted crisp currentColor tool logos (aider monogram + internal eaon mark). */
const HANDCRAFTED_TOOL_LOGOS: Record<string, LogoSvg> = {
  aider: {
    viewBox: "0 0 24 24",
    body: '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7.5 15l3.5-6 3.5 6"/><path d="M8.6 13h4.8"/><path d="M16.5 15h.01"/></g>',
  },
  eaon: {
    viewBox: "0 0 200 200",
    body: '<path fill="currentColor" fill-rule="evenodd" d="M186.6 50A100 100 0 1 0 186.6 150H103A15 15 0 0 1 103 120H197.98A100 100 0 0 0 197.98 80H103A15 15 0 0 1 103 50Z"/>',
  },
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return (await res.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`${url}: ${res.status} ${res.statusText}`);
  return res.text();
}

async function main() {
  const [apiCatalog, modelsIndex, defaultSparkleSvg] = await Promise.all([
    fetchJson<ModelsDevCatalog>(CATALOG_URL),
    fetchJson<ModelsDevModelsIndex>(MODELS_INDEX_URL),
    fetchText(`${PROVIDER_LOGO_BASE_URL}/__tokn_default_probe__.svg`),
  ]);

  const map = buildLogoCatalogMap(apiCatalog, modelsIndex);

  // Bundle core creator labs and major host fallbacks locally for zero-request rendering.
  // Long-tail or newly launched labs/resellers resolve dynamically via /api/logos/model/[id].
  const candidates = new Set<string>([
    "anthropic",
    "openai",
    "google",
    "xai",
    "deepseek",
    "alibaba",
    "zhipuai",
    "moonshotai",
    "meta",
    "mistral",
    "minimax",
    "inception",
    "cohere",
    "perplexity",
    "nvidia",
    "xiaomi",
    "stepfun",
    "amazon-bedrock",
    "azure",
    "google-vertex",
    "microsoft",
    "tencent",
    "baidu",
    "bytedance-seed",
    "ai21",
    "ibm",
    "allenai",
    "arcee-ai",
    "liquid",
    "sarvam",
    "upstage",
    "huawei",
    "opencode",
    "openrouter",
    "github-copilot",
    "groq",
    "cerebras",
    "fireworks-ai",
    "togetherai",
    "vercel",
    "huggingface",
  ]);

  const modelLogos: Record<string, LogoSvg> = {};
  const warnings: string[] = [];

  await Promise.all(
    [...candidates].sort().map(async (id) => {
      let svg = await fetchLabLogoSvg(id, { defaultSparkleSvg });
      if (!svg && SUPPLEMENTAL_LAB_URLS[id]) {
        try {
          const raw = await fetchText(SUPPLEMENTAL_LAB_URLS[id]);
          if (/#fff(?:fff)?\b/i.test(raw)) {
            warnings.push(`supplemental lab '${id}' raw SVG contained #fff`);
          }
          svg = sanitizeLogoSvg(raw, defaultSparkleSvg);
        } catch (err) {
          warnings.push(`failed supplemental lab '${id}': ${String(err)}`);
        }
      }
      if (svg) {
        modelLogos[id] = svg;
      }
    }),
  );

  // Filter modelLabs & familyLabs to labs that currently have a verified bundled SVG.
  const sortedModelLogos = Object.fromEntries(
    Object.entries(modelLogos).sort(([a], [b]) => a.localeCompare(b)),
  );
  const sortedModelLabs = Object.fromEntries(
    Object.entries(map.modelLabs)
      .filter(([, lab]) => Boolean(modelLogos[lab]))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  const sortedFamilyLabs = Object.fromEntries(
    Object.entries(map.familyLabs)
      .filter(([, lab]) => Boolean(modelLogos[lab]))
      .sort(([a], [b]) => a.localeCompare(b)),
  );

  const toolLogos: Record<string, LogoSvg> = { ...HANDCRAFTED_TOOL_LOGOS };
  await Promise.all(
    Object.entries(TOOL_LOGO_URLS).map(async ([tool, url]) => {
      const raw = await fetchText(url);
      if (/#fff(?:fff)?\b/i.test(raw)) {
        warnings.push(`tool '${tool}' raw SVG contained #fff`);
      }
      const svg = sanitizeLogoSvg(raw, defaultSparkleSvg);
      if (!svg) throw new Error(`Failed to sanitize tool SVG for '${tool}' from ${url}`);
      toolLogos[tool] = svg;
    }),
  );

  const sortedToolLogos = Object.fromEntries(
    Object.entries(toolLogos).sort(([a], [b]) => a.localeCompare(b)),
  );

  const output = `/* Generated by pricing/gen-logos.ts from models.dev and official monochrome tool icons. Do not edit by hand. */

export interface GeneratedLogoSvg {
  readonly viewBox: string;
  readonly body: string;
}

export const BUNDLED_MODEL_LOGOS: Record<string, GeneratedLogoSvg> = ${JSON.stringify(sortedModelLogos, null, 2)};

export const BUNDLED_MODEL_LABS: Record<string, string> = ${JSON.stringify(sortedModelLabs, null, 2)};

export const BUNDLED_FAMILY_LABS: Record<string, string> = ${JSON.stringify(sortedFamilyLabs, null, 2)};

export const BUNDLED_TOOL_LOGOS: Record<string, GeneratedLogoSvg> = ${JSON.stringify(sortedToolLogos, null, 2)};
`;

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  writeFileSync(OUT_FILE, output, "utf8");

  console.log(
    `Generated ${OUT_FILE}: ${Object.keys(sortedModelLogos).length} model/lab logos, ` +
      `${Object.keys(sortedModelLabs).length} non-prefix model mappings, ` +
      `${Object.keys(sortedFamilyLabs).length} family mappings, ` +
      `${Object.keys(sortedToolLogos).length} tool logos.`,
  );
  if (warnings.length > 0) {
    console.warn("Warnings:", warnings);
  }
}

await main();
