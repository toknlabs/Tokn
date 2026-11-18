/**
 * Browser-safe pure model logo resolution and SVG sanitization primitives.
 *
 * Intentionally has zero Node built-in imports so Next.js client components and
 * server components can share the exact same lab aliases, prefix rules, and
 * SVG sanitizer without bundling `node:fs`.
 */

import { normalizeModelId } from "./normalize.ts";

export interface LogoSvg {
  viewBox: string;
  body: string;
}

export interface LogoCatalogMap {
  /** Normalized/bare model ID -> canonical creator lab ID. */
  modelLabs: Record<string, string>;
  /** models.dev family -> canonical creator lab ID (when unambiguous). */
  familyLabs: Record<string, string>;
}

/** Distinct path fragment from models.dev's fallback sparkle SVG when no custom icon exists. */
const DEFAULT_SPARKLE_FRAGMENT = "M9.8132 15.9038L9 18.75";

const SAFE_LOGO_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

/** Provider / vendor slug aliases mapped to canonical logo IDs. */
const LAB_ALIASES: Record<string, string> = {
  "x-ai": "xai",
  xai: "xai",
  "z-ai": "zhipuai",
  zai: "zhipuai",
  "zai-coding-plan": "zhipuai",
  zhipu: "zhipuai",
  zhipuai: "zhipuai",
  "meta-llama": "meta",
  llama: "meta",
  meta: "meta",
  qwen: "alibaba",
  alibaba: "alibaba",
  "alibaba-cn": "alibaba",
  "alibaba-us": "alibaba",
  dashscope: "alibaba",
  moonshot: "moonshotai",
  moonshotai: "moonshotai",
  "moonshotai-cn": "moonshotai",
  kimi: "moonshotai",
  "kimi-for-coding": "moonshotai",
  mistralai: "mistral",
  mistral: "mistral",
  anthropic: "anthropic",
  openai: "openai",
  google: "google",
  gemini: "google",
  "google-vertex": "google-vertex",
  "google-vertex-anthropic": "google-vertex",
  deepseek: "deepseek",
  minimax: "minimax",
  "minimax-cn": "minimax",
  "minimax-coding-plan": "minimax",
  inception: "inception",
  cohere: "cohere",
  perplexity: "perplexity",
  nvidia: "nvidia",
  xiaomi: "xiaomi",
  stepfun: "stepfun",
  tencent: "tencent",
  baidu: "baidu",
  ernie: "baidu",
  ai21: "ai21",
  ibm: "ibm",
  allenai: "allenai",
  "arcee-ai": "arcee-ai",
  arcee: "arcee-ai",
  liquid: "liquid",
  sarvam: "sarvam",
  bytedance: "bytedance-seed",
  "bytedance-seed": "bytedance-seed",
  microsoft: "microsoft",
  azure: "azure",
  "azure-cognitive-services": "azure",
  aws: "amazon-bedrock",
  amazon: "amazon-bedrock",
  "amazon-bedrock": "amazon-bedrock",
  bedrock: "amazon-bedrock",
  together: "togetherai",
  togetherai: "togetherai",
  fireworks: "fireworks-ai",
  "fireworks-ai": "fireworks-ai",
  copilot: "github-copilot",
  "github-copilot": "github-copilot",
  "github-models": "github-copilot",
  opencode: "opencode",
  "opencode-go": "opencode",
  openrouter: "openrouter",
  vercel: "vercel",
  groq: "groq",
  cerebras: "cerebras",
  deepinfra: "deepinfra",
  huawei: "huawei",
  upstage: "upstage",
  "302ai": "302ai",
};

/** Reseller / cloud-hosting providers whose branding yields to the model's creator lab. */
export const RESELLER_PROVIDERS = new Set([
  "openrouter",
  "vercel",
  "opencode",
  "opencode-go",
  "github-copilot",
  "github-models",
  "groq",
  "cerebras",
  "fireworks-ai",
  "fireworks",
  "togetherai",
  "together",
  "deepinfra",
  "amazon-bedrock",
  "bedrock",
  "azure",
  "azure-cognitive-services",
  "google-vertex",
  "google-vertex-anthropic",
  "cloudflare-workers-ai",
  "huggingface",
  "replicate",
  "baseten",
  "nebius",
  "novita-ai",
  "siliconflow",
  "chutes",
  "featherless-ai",
  "friendli",
  "helicone",
  "requesty",
  "subnp",
  "scaleway",
  "ovhcloud",
  "venice",
  "wandb",
  "302ai",
  "poe",
  "zenmux",
  "synthetic",
  "kilo",
  "vivgrid",
  "unbiased",
]);

/** Deterministic creator lab inference from normalized bare model names (forward-compatible across versions). */
const MODEL_PREFIX_RULES: readonly [RegExp, string][] = [
  [/nemotron/, "nvidia"],
  [/^claude(?:[-_.]|$)/, "anthropic"],
  [/^(?:ft:)?(?:gpt|o[1345]|chatgpt|codex|davinci|curie|babbage|ada|text-embedding|whisper|dall-e|sora)(?:[-_.]|$)/, "openai"],
  [/^(?:gemini|gemma|learnlm|imagen|veo|palm|bison|lyria|deep-research|diffusiongemma)(?:[-_.]|$)/, "google"],
  [/^grok(?:[-_.]|$)/, "xai"],
  [/^deepseek(?:[-_.]|$)/, "deepseek"],
  [/^(?:qwen|qwq|qvq|wan)(?:[0-9._-]|$)/, "alibaba"],
  [/^(?:glm|chatglm|cogview|codegeex)(?:[0-9._-]|$)/, "zhipuai"],
  [/^(?:kimi|moonshot)(?:[-_.]|$)/, "moonshotai"],
  [/^(?:llama|codellama|meta-llama|muse)(?:[0-9._-]|$)/, "meta"],
  [/^(?:mistral|mixtral|codestral|devstral|ministral|magistral|pixtral|mathstral|voxtral)(?:[-_.]|$)/, "mistral"],
  [/^(?:minimax|abab)(?:[0-9._-]|$)/, "minimax"],
  [/^mercury(?:[-_.]|$)/, "inception"],
  [/^(?:command|c4ai-command|aya|tiny-aya|north|embed-(?:english|multilingual))(?:[-_.]|$)/, "cohere"],
  [/^(?:sonar|r1-1776)(?:[-_.]|$)/, "perplexity"],
  [/^mimo(?:[-_.]|$)/, "xiaomi"],
  [/^step(?:[0-9._-]|$)/, "stepfun"],
  [/^(?:nova|titan)(?:[-_.]|$)/, "amazon-bedrock"],
  [/^(?:phi|mai|wizardlm)(?:[0-9._-]|$)/, "microsoft"],
  [/^sarvam(?:[-_.]|$)/, "sarvam"],
  [/^(?:hunyuan|hy\d|hy-)(?:[-_.]|$)/, "tencent"],
  [/^ernie(?:[-_.]|$)/, "baidu"],
  [/^(?:doubao|seed)(?:[-_.]|$)/, "bytedance-seed"],
  [/^jamba(?:[-_.]|$)/, "ai21"],
  [/^granite(?:[-_.]|$)/, "ibm"],
  [/^(?:olmo|molmo|tulu)(?:[-_.]|$)/, "allenai"],
  [/^trinity(?:[-_.]|$)/, "arcee-ai"],
  [/^lfm(?:[0-9._-]|$)/, "liquid"],
  [/^solar(?:[-_.]|$)/, "upstage"],
  [/^(?:pangu|openpangu)(?:[-_.]|$)/, "huawei"],
  [/^big-pickle(?:[-_.]|$)/, "opencode"],
];

/** Canonicalize a provider, vendor, or lab slug to a safe logo ID. */
export function normalizeLabId(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase().replace(/^@/, "");
  if (!key) return null;
  const mapped = LAB_ALIASES[key] ?? key;
  return SAFE_LOGO_ID_RE.test(mapped) ? mapped : null;
}

function stripVariantSuffix(model: string): string {
  // OpenRouter and Bedrock append ":free", ":thinking", ":0", etc.
  return model.replace(/:[^/]+$/, "");
}

function stripRegionPrefix(segment: string): string {
  return segment.replace(/^(?:us|eu|ap|ca|sa|me|af|global)\./i, "");
}

/**
 * Inspect explicit vendor namespaces on a raw model ID before normalization strips them,
 * e.g. `openrouter/x-ai/grok-code-fast-1` -> `"xai"`, `us.anthropic.claude-3-5` -> `"anthropic"`.
 */
export function extractModelVendor(raw: string): {
  creator: string | null;
  reseller: string | null;
  bareModel: string;
} {
  const trimmed = stripVariantSuffix(raw.trim().toLowerCase());
  const parts = trimmed.split("/").filter(Boolean);

  let reseller: string | null = null;
  let idx = 0;

  while (idx < parts.length - 1) {
    const rawSeg = parts[idx];
    // Cloudflare Workers AI uses "@cf/<vendor>/<model>" and "@hf/<vendor>/<model>".
    if (rawSeg === "@cf" || rawSeg === "@hf") {
      reseller ??= "cloudflare-workers-ai";
      idx += 1;
      continue;
    }
    const seg = stripRegionPrefix(rawSeg);
    // Skip Fireworks routing wrapper `accounts/<org>/models/<id>`
    if (seg === "accounts" && idx + 3 < parts.length && parts[idx + 2] === "models") {
      reseller ??= normalizeLabId(parts[idx + 1]);
      idx += 3;
      continue;
    }
    const lab = normalizeLabId(seg);
    if (lab && RESELLER_PROVIDERS.has(lab)) {
      reseller ??= lab;
      idx += 1;
      continue;
    }
    if (lab) {
      return {
        creator: lab,
        reseller,
        bareModel: stripRegionPrefix(parts.slice(idx + 1).join("/")),
      };
    }
    idx += 1;
  }

  const tail = stripRegionPrefix(parts[parts.length - 1] ?? trimmed);
  const sepMatch =
    /^(?:[a-z0-9]+[-_]+)?(anthropic|amazon|meta|mistral|deepseek|google|openai|x-ai|xai|qwen|alibaba|zhipuai|zhipu|moonshotai|moonshot|kimi|minimax|cohere|inception|perplexity|nvidia|xiaomi|stepfun|ai21)(?:--|\.|-(?=(?:claude|gpt|o[1345]|gemini|gemma|llama|mistral|mixtral|codestral|devstral|deepseek|grok|qwen|glm|kimi|minimax|command|sonar|mercury|nova|titan|nemotron|jamba)))([a-z0-9].*)$/.exec(
      tail,
    );
  if (sepMatch) {
    const lab = normalizeLabId(sepMatch[1]);
    return {
      creator: lab && !RESELLER_PROVIDERS.has(lab) ? lab : null,
      reseller: lab && RESELLER_PROVIDERS.has(lab) ? lab : reseller,
      bareModel: sepMatch[2],
    };
  }

  return { creator: null, reseller, bareModel: tail };
}

/** Infer creator lab from model naming conventions when no catalog lookup is needed. */
export function inferLabFromModelName(rawModel: string): string | null {
  const { bareModel } = extractModelVendor(rawModel);
  const candidates = [bareModel, normalizeModelId(bareModel), normalizeModelId(rawModel)];
  for (const candidate of candidates) {
    const clean = stripVariantSuffix(candidate.trim().toLowerCase());
    if (!clean) continue;
    for (const [pattern, lab] of MODEL_PREFIX_RULES) {
      if (pattern.test(clean)) return lab;
    }
  }
  return null;
}

export interface ResolveLogoInput {
  model: string;
  /** Optional model -> lab map from models.json or generated catalog. */
  modelLabs?: Record<string, string>;
  /** Optional provider column from `pricing` table / catalog. */
  provider?: string | null;
  /** Optional models.dev family if known. */
  family?: string | null;
  familyLabs?: Record<string, string>;
  /** If provided, restricts returned IDs to verified known IDs unless unresolved fallback is wanted. */
  knownLogos?: ReadonlySet<string>;
}

function pickIfKnown(id: string | null, knownLogos?: ReadonlySet<string>): string | null {
  if (!id) return null;
  if (!knownLogos || knownLogos.has(id)) return id;
  return null;
}

/**
 * Resolve the canonical logo ID for a model ID using creator-first precedence:
 * 1. Explicit creator vendor namespace (`x-ai/grok-3`, `us.anthropic.claude-...`)
 * 2. Model name prefix/family rules (`claude-*`, `gpt-*`, `gemini-*`, `glm-*`, ...)
 * 3. `models.dev/models.json` exact bare/normalized model lookup (distinguishes `big-pickle` -> `opencode`)
 * 4. `family` lookup from `models.dev/api.json`
 * 5. `provider` column from database (`pricing.provider`, non-reseller first)
 * 6. Reseller namespace / provider fallback (`opencode`, `openrouter`, `github-copilot`, ...)
 */
export function resolveModelLogoId(input: ResolveLogoInput): string | null {
  const { creator, reseller, bareModel } = extractModelVendor(input.model);
  const known = input.knownLogos;

  const explicitCreator = pickIfKnown(creator, known);
  if (explicitCreator) return explicitCreator;

  const inferred = pickIfKnown(inferLabFromModelName(input.model), known);
  if (inferred) return inferred;

  if (input.modelLabs) {
    const keys = [
      input.model.trim().toLowerCase(),
      bareModel,
      normalizeModelId(bareModel),
      normalizeModelId(input.model),
    ];
    for (const key of keys) {
      const lab = pickIfKnown(normalizeLabId(input.modelLabs[key]), known);
      if (lab) return lab;
    }
  }

  if (input.family && input.familyLabs) {
    const fam = pickIfKnown(normalizeLabId(input.familyLabs[input.family.toLowerCase()]), known);
    if (fam) return fam;
  }

  const providerLab = normalizeLabId(input.provider);
  if (providerLab && !RESELLER_PROVIDERS.has(providerLab)) {
    const matched = pickIfKnown(providerLab, known);
    if (matched) return matched;
  }

  const resellerFallback = pickIfKnown(reseller, known) ?? pickIfKnown(providerLab, known);
  if (resellerFallback) return resellerFallback;

  // When knownLogos wasn't passed, return the normalized raw hint if any existed.
  return !known ? (creator ?? providerLab ?? reseller) : null;
}

const ALLOWED_SVG_TAGS = new Set([
  "g",
  "path",
  "circle",
  "rect",
  "polygon",
  "polyline",
  "line",
  "ellipse",
  "defs",
  "clippath",
  "mask",
]);

const SHAPE_SVG_TAG_RE = /<(path|circle|rect|polygon|polyline|line|ellipse)\b/i;

function readAttr(attrs: string, name: string): string | null {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(attrs);
  return match ? (match[1] ?? match[2] ?? "").trim() : null;
}

function normalizePaintValue(val: string): string {
  const v = val.trim();
  const lower = v.toLowerCase();
  if (
    !v ||
    lower === "none" ||
    lower === "transparent" ||
    lower === "currentcolor" ||
    lower === "inherit" ||
    lower.startsWith("url(#")
  ) {
    return v;
  }
  return "currentColor";
}

function escapeAttr(val: string): string {
  return val.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function convertInlineStyleToAttrs(styleValue: string): string {
  const out: string[] = [];
  for (const decl of styleValue.split(";")) {
    const colon = decl.indexOf(":");
    if (colon <= 0) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const rawVal = decl.slice(colon + 1).trim();
    if (!rawVal || /expression|javascript:|url\s*\(\s*["']?(?!#)/i.test(rawVal)) continue;
    if (prop === "fill" || prop === "stroke") {
      out.push(`${prop}="${escapeAttr(normalizePaintValue(rawVal))}"`);
    } else if (
      prop === "fill-rule" ||
      prop === "clip-rule" ||
      prop === "fill-opacity" ||
      prop === "stroke-opacity" ||
      prop === "stroke-width" ||
      prop === "stroke-linecap" ||
      prop === "stroke-linejoin" ||
      prop === "opacity"
    ) {
      out.push(`${prop}="${escapeAttr(rawVal)}"`);
    } else if (prop === "clip-path" && /^url\(#[^)]+\)$/i.test(rawVal)) {
      out.push(`clip-path="${escapeAttr(rawVal)}"`);
    }
  }
  return out.join(" ");
}

function sanitizeAttributes(attrs: string): string {
  const safe: string[] = [];
  const attrRe = /([a-zA-Z_:][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let match: RegExpExecArray | null;
  while ((match = attrRe.exec(attrs)) !== null) {
    const name = match[1];
    const lower = name.toLowerCase();
    const value = (match[2] ?? match[3] ?? "").trim();

    if (lower.startsWith("on") || lower === "class" || lower === "xmlns" || lower.startsWith("xmlns:")) {
      continue;
    }
    if (lower === "href" || lower === "xlink:href") {
      if (!value.startsWith("#")) continue;
    }
    if (/javascript:|data:/i.test(value)) continue;

    if (lower === "style") {
      const converted = convertInlineStyleToAttrs(value);
      if (converted) safe.push(converted);
      continue;
    }
    if (lower === "fill" || lower === "stroke") {
      safe.push(`${lower}="${escapeAttr(normalizePaintValue(value))}"`);
      continue;
    }
    safe.push(`${name}="${escapeAttr(value)}"`);
  }
  return safe.join(" ");
}

/**
 * Validate and sanitize an SVG into `{ viewBox, body }` with monochrome `currentColor` fills/strokes.
 * Returns `null` if the SVG is invalid, unsafe, empty, or matches models.dev's default sparkle icon.
 */
export function sanitizeLogoSvg(rawSvg: string, defaultSparkleSvg?: string | null): LogoSvg | null {
  if (!rawSvg) return null;
  if (defaultSparkleSvg && rawSvg.trim() === defaultSparkleSvg.trim()) return null;
  if (rawSvg.includes(DEFAULT_SPARKLE_FRAGMENT)) return null;

  const cleaned = rawSvg
    .replace(/<\?xml[\s\S]*?\?>/gi, "")
    .replace(/<!DOCTYPE[\s\S]*?>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();

  if (/<(script|foreignObject|iframe|object|embed|image)\b/i.test(cleaned)) {
    return null;
  }

  const rootMatch = /<svg\b([^>]*)>([\s\S]*)<\/svg>/i.exec(cleaned);
  if (!rootMatch) return null;

  const rootAttrs = rootMatch[1];
  let body = rootMatch[2]
    .replace(/<(title|desc|metadata|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!body) return null;

  let viewBox = readAttr(rootAttrs, "viewBox");
  if (!viewBox) {
    const w = parseFloat(readAttr(rootAttrs, "width") ?? "");
    const h = parseFloat(readAttr(rootAttrs, "height") ?? "");
    viewBox = Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0 ? `0 0 ${w} ${h}` : "0 0 24 24";
  }
  if (!/^-?\d+(?:\.\d+)?(?:\s+-?\d+(?:\.\d+)?){3}$/.test(viewBox)) {
    return null;
  }

  // Reconstruct only allowlisted tags with sanitized attributes.
  let hasDisallowedTag = false;
  body = body.replace(/<(\/?)([a-zA-Z][\w:-]*)([^>]*?)(\/?)>/g, (_m, close, rawTag, attrs, selfClose) => {
    const tag = rawTag.toLowerCase();
    if (!ALLOWED_SVG_TAGS.has(tag)) {
      hasDisallowedTag = true;
      return "";
    }
    if (close) return `</${tag}>`;
    const cleanAttrs = sanitizeAttributes(attrs);
    return `<${tag}${cleanAttrs ? ` ${cleanAttrs}` : ""}${selfClose ? "/" : ""}>`;
  });

  if (hasDisallowedTag && !SHAPE_SVG_TAG_RE.test(body)) return null;
  body = body.replace(/>\s+</g, "><").trim();
  if (!SHAPE_SVG_TAG_RE.test(body)) return null;

  // Preserve root-level paint defaults (especially stroke-based or fill="currentColor" SVGs).
  const rootFill = readAttr(rootAttrs, "fill");
  const rootStroke = readAttr(rootAttrs, "stroke");
  const wrapperAttrs: string[] = [];
  if (rootStroke && rootStroke.toLowerCase() !== "none") {
    wrapperAttrs.push(`fill="${escapeAttr(rootFill ? normalizePaintValue(rootFill) : "none")}"`);
    wrapperAttrs.push(`stroke="${escapeAttr(normalizePaintValue(rootStroke))}"`);
    for (const extra of ["stroke-width", "stroke-linecap", "stroke-linejoin"]) {
      const val = readAttr(rootAttrs, extra);
      if (val) wrapperAttrs.push(`${extra}="${escapeAttr(val)}"`);
    }
  } else if (rootFill && rootFill.toLowerCase() === "currentcolor") {
    wrapperAttrs.push('fill="currentColor"');
  } else if (!/\bfill="/i.test(body)) {
    // SVG default fill is black; make unpainted geometry inherit currentColor.
    wrapperAttrs.push('fill="currentColor"');
  }

  if (wrapperAttrs.length > 0) {
    body = `<g ${wrapperAttrs.join(" ")}>${body}</g>`;
  }

  return { viewBox, body };
}

/** Serialize a sanitized `LogoSvg` as a standalone SVG document (for API/file serving & CSS masks). */
export function renderSvgDocument(svg: LogoSvg): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${escapeAttr(svg.viewBox)}" fill="none">${svg.body}</svg>`;
}
