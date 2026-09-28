import fs from "node:fs";
import { buildPriceTable, cliTuple, fetchCatalog, loadOverrides, providersUsed } from "./catalog.ts";

/**
 * Write `cli/src/core/pricing-data.ts`.
 *
 *   node --experimental-strip-types pricing/render.ts [out-file]
 *
 * The generated file is the CLI's offline fallback. It is a snapshot of the
 * same table the server refresh writes to Appwrite.
 */

const PROBES = ["claude-opus-5", "claude-sonnet-5", "gpt-5.2", "gemini-3-pro", "grok-5", "deepseek-v3.2"];

function renderOverrides(overrides: ReturnType<typeof loadOverrides>): string {
  const lines: string[] = [];
  for (const [id, override] of Object.entries(overrides).sort((a, b) => a[0].localeCompare(b[0]))) {
    const fields: string[] = [];
    if (typeof override.cacheRead === "number") fields.push(`cacheRead: ${override.cacheRead}`);
    if (typeof override.cacheWrite === "number") fields.push(`cacheWrite: ${override.cacheWrite}`);
    if (typeof override.cacheWrite1h === "number") fields.push(`cacheWrite1h: ${override.cacheWrite1h}`);
    if (typeof override.fastInput === "number" && typeof override.fastOutput === "number") {
      fields.push(`fast: { input: ${override.fastInput}, output: ${override.fastOutput} }`);
    }
    if (fields.length === 0) continue;
    lines.push(`  ${JSON.stringify(id)}: { ${fields.join(", ")} },`);
  }
  return lines.join("\n");
}

export function renderPricingModule(
  rows: ReturnType<typeof buildPriceTable>,
  providerCount: number,
  generatedAt: string,
  overrides: ReturnType<typeof loadOverrides>,
): string {
  const tuples = rows.map((row) => `  ${JSON.stringify(row.modelId)}: [${cliTuple(row).join(",")}],`);
  return `/**
 * Model prices, in US dollars per million tokens.
 *
 * GENERATED FILE — do not edit by hand. Regenerate with:
 *   npm run pricing
 *
 * Source: the models.dev catalog (${rows.length} models across ${providerCount}
 * providers), built by \`pricing/catalog.ts\` and patched with
 * \`pricing/overrides.json\`. Model ids are stored normalized: provider
 * prefixes, Bedrock version suffixes, Vertex @-versions and dated snapshots
 * are stripped, so every spelling of a model resolves to one row. A leading
 * \`~\` is kept, which is why aliases like \`~openai/gpt-luna-latest\` stay
 * distinct from \`gpt-6-luna\`.
 *
 * Tuple layout: [input, output, cacheRead?, cacheWrite?]
 * A missing cacheRead/cacheWrite means the provider publishes no separate cache
 * rate, and \`pricing.ts\` falls back to sensible multiples of the input rate.
 * \`PRICING_OVERRIDES\` carries what the catalog cannot: Anthropic's 1-hour
 * cache tier and fast mode.
 *
 * This table is the offline fallback. \`tokn sync\` refreshes it from the
 * dashboard so a model released after this CLI shipped is still priced.
 */

export const CATALOG_GENERATED_AT = ${JSON.stringify(generatedAt)};

export const PRICING_OVERRIDES: Record<
  string,
  {
    cacheRead?: number;
    cacheWrite?: number;
    cacheWrite1h?: number;
    fast?: { input: number; output: number };
  }
> = {
${renderOverrides(overrides)}
};

export const CATALOG: Record<string, number[]> = {
${tuples.join("\n")}
};
`;
}

async function main(): Promise<void> {
  const outFile = process.argv[2];
  if (!outFile) throw new Error("usage: render.ts <out-file>");

  const catalog = await fetchCatalog();
  const overrides = loadOverrides();
  const rows = buildPriceTable(catalog, overrides);
  const generatedAt = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(outFile, renderPricingModule(rows, providersUsed(catalog), generatedAt, overrides));

  console.log(`wrote ${rows.length} models from ${providersUsed(catalog)} providers to ${outFile}`);
  const byId = new Map(rows.map((row) => [row.modelId, row]));
  for (const probe of PROBES) {
    const row = byId.get(probe);
    if (!row) {
      console.log(`  ${probe} -> MISSING`);
      continue;
    }
    console.log(
      `  ${probe} -> [${row.input}, ${row.output}` +
        (row.cacheRead !== null ? `, ${row.cacheRead}` : "") +
        (row.cacheWrite !== null ? `, ${row.cacheWrite}` : "") +
        "]",
    );
  }
}

const invokedDirectly = process.argv[1] && fileIsThisModule(process.argv[1]);

function fileIsThisModule(argvPath: string): boolean {
  return argvPath.endsWith("render.ts") || argvPath.endsWith("render.js");
}

if (invokedDirectly) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
