/**
 * Display helpers, plus a small Anthropic rate card used only by the local
 * demo seed (`web/scripts/seed.ts`).
 *
 * This is not the table the CLI downloads. Live rates are built by
 * `pricing/catalog.ts` and stored in Appwrite; `GET /api/cli/pricing` reads
 * that collection. Do not add newly released models here.
 */

export interface ModelPrice {
  input: number;
  output: number;
  cacheReadMultiplier?: number;
  fast?: { input: number; output: number };
}

export const PRICING: Record<string, ModelPrice> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheReadMultiplier: 0.025 },
  "claude-mythos-5-1": { input: 10, output: 50 },
  "claude-fable-5": { input: 10, output: 50 },
  "claude-mythos-5": { input: 10, output: 50 },
  "claude-opus-5": { input: 5, output: 25, fast: { input: 10, output: 50 } },
  "claude-opus-4-8": { input: 5, output: 25, fast: { input: 10, output: 50 } },
  "claude-opus-4-7": { input: 5, output: 25 },
  "claude-opus-4-6": { input: 5, output: 25 },
  "claude-opus-4-5": { input: 5, output: 25 },
  "claude-sonnet-5": { input: 2, output: 10 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4-5": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 1, output: 5 },
};

/**
 * Families whose capitalisation is not just "first letter upper".
 *
 * Everything else title-cases fine on its own; these are the acronyms and
 * intercaps that would otherwise read as "Gpt" and "Deepseek".
 */
const FAMILIES: Record<string, string> = {
  gpt: "GPT",
  glm: "GLM",
  deepseek: "DeepSeek",
  qwen: "Qwen",
  qwen2: "Qwen2",
  qwen3: "Qwen3",
  llama: "Llama",
  gemini: "Gemini",
  kimi: "Kimi",
  grok: "Grok",
  mistral: "Mistral",
  codestral: "Codestral",
  phi: "Phi",
  nova: "Nova",
  command: "Command",
};

const upperFirst = (word: string): string => word.charAt(0).toUpperCase() + word.slice(1);

/** "5.6", "3", "4o", "v4" — a version, not a word, so it is left alone. */
const isVersion = (part: string): boolean => /^v?\d/.test(part);

/**
 * Short label for a model id, for tables and legends.
 *
 * Anthropic ids are hyphen-separated digits — `claude-haiku-4-5` means 4.5 —
 * so those segments join with dots. No other provider names models that way:
 * `gpt-6-astra` and `deepseek-v4-flash` are words, and joining them with dots
 * produces "Gpt 6.astra". They join with spaces instead.
 */
export function modelLabel(model: string): string {
  const parts = model.split("-");

  if (parts[0] === "claude") {
    parts.shift();
    const family = parts.shift() ?? model;
    const version = parts.join(".");
    return version ? `${upperFirst(family)} ${version}` : upperFirst(family);
  }

  const family = parts.shift() ?? model;
  const name = FAMILIES[family.toLowerCase()] ?? upperFirst(family);
  const rest = parts.map((part) => (isVersion(part) ? part : upperFirst(part)));
  return [name, ...rest].join(" ");
}

/**
 * A stable colour per model family, so the same model keeps its colour across
 * every chart on the site.
 */
export function modelColor(model: string): string {
  if (model.includes("opus")) return "var(--main)";
  if (model.includes("sonnet")) return "var(--sub)";
  if (model.includes("haiku")) return "var(--text)";
  if (model.includes("fable") || model.includes("mythos")) return "var(--error)";
  return "var(--sub-dim)";
}
