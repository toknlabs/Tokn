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

/** Short label for a model id, for tables and legends. */
export function modelLabel(model: string): string {
  const known = model.replace(/^claude-/, "");
  const parts = known.split("-");
  const family = parts.shift() ?? known;
  const version = parts.join(".");
  const name = family.charAt(0).toUpperCase() + family.slice(1);
  return version ? `${name} ${version}` : name;
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
