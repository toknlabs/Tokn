import assert from "node:assert/strict";
import test from "node:test";
import { assess } from "../src/repo/integrity.ts";
import type { SyncRow } from "../src/repo/usage.ts";
import type { CliPrice } from "../src/repo/pricing.ts";

const prices: Record<string, CliPrice> = {
  "sample-small": { input: 1.25, output: 3.5, cacheRead: 0.125, cacheWrite: 1.5625 },
  "sample-large": { input: 4, output: 16, cacheRead: 0.4, cacheWrite: 5 },
};

function row(model: string, overrides: Partial<SyncRow> = {}): SyncRow {
  return {
    day: "2026-09-25",
    tool: "codex",
    model,
    fast: false,
    requests: 1,
    input: 1_000_000,
    output: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
    costUsd: 999,
    ...overrides,
  };
}

test("prefixed and canonical ids price from the shared table, and the client cost is discarded", async () => {
  const result = await assess(
    [row("sample-small"), row("openai/sample-small"), row("sample-large"), row("~openai/sample-latest")],
    prices,
  );

  assert.equal(result.rejected.length, 1);
  assert.equal(result.rejected[0]?.reason, "unpriceable-model");
  assert.equal(result.rejected[0]?.model, "~openai/sample-latest");
  assert.equal(result.rows.length, 3);
  assert.equal(result.rows[0]?.costUsd, 1.25);
  assert.equal(result.rows[1]?.costUsd, 1.25);
  assert.equal(result.rows[2]?.costUsd, 4);
});

test("a model with no row is rejected rather than stored at the client's price", async () => {
  const result = await assess([row("not-a-model")], prices);
  assert.equal(result.rows.length, 0);
  assert.equal(result.rejected[0]?.reason, "unpriceable-model");
});
