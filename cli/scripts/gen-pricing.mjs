// Writes src/core/pricing-data.ts from the shared catalog builder.
// Re-run with: npm run pricing
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const render = path.resolve(here, "../../pricing/render.ts");
const out = process.argv[2] ?? path.resolve(here, "../src/core/pricing-data.ts");

const result = spawnSync(
  process.execPath,
  ["--experimental-strip-types", render, out],
  { stdio: "inherit" },
);

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
