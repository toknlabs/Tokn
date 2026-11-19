import assert from "node:assert/strict";
import test from "node:test";
import { assess, implausible, overDay } from "../src/repo/integrity.ts";
import { canonicalModelId, summarize, type SyncRow } from "../src/repo/usage.ts";
import type { CliPrice } from "../src/repo/pricing.ts";

const prices: Record<string, CliPrice> = {
  "sample-small": { input: 1.25, output: 3.5, cacheRead: 0.125, cacheWrite: 1.5625 },
  "sample-large": { input: 4, output: 16, cacheRead: 0.4, cacheWrite: 5 },
};

// Inside the age limit whenever the suite runs.
const TODAY = new Date().toISOString().slice(0, 10);

function row(model: string, overrides: Partial<SyncRow> = {}): SyncRow {
  return {
    day: TODAY,
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
    { prices },
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
  const result = await assess([row("not-a-model")], { prices });
  assert.equal(result.rows.length, 0);
  assert.equal(result.rejected[0]?.reason, "unpriceable-model");
});

test("the reported forgery: 500M output tokens on one day is refused, with the day's honest rows", async () => {
  // 500M output at $16/M is $8,000, a round figure built to land on the board.
  // Enough requests are claimed to clear every per-request check.
  const forged = row("sample-large", { tool: "claude-code", requests: 600, input: 0, output: 500_000_000 });
  const honest = row("sample-small", { tool: "codex", requests: 200, input: 400_000, output: 90_000 });

  const result = await assess([forged, honest], { prices });

  assert.equal(result.rows.length, 0);
  assert.equal(result.costUsd, 0);
  assert.deepEqual(
    result.rejected.map((r) => r.reason),
    ["output-per-day", "output-per-day"],
  );
});

test("a forged day spread across many buckets is judged as one day", async () => {
  // Each row is unremarkable on its own; six of them are not.
  const rows = ["a", "b", "c", "d", "e", "f"].map((tool) =>
    row("sample-large", { tool, requests: 400, input: 0, output: 9_000_000 }),
  );

  const result = await assess(rows, { prices });

  assert.equal(result.rows.length, 0);
  assert.equal(result.rejected[0]?.reason, "output-per-day");
});

test("stored rows count toward the day, unless this sync overwrites them", async () => {
  const stored = [
    { ...row("sample-large", { tool: "one", requests: 400, input: 0, output: 30_000_000 }), costUsd: 480 },
  ];

  // A second bucket on top of what is stored crosses the ceiling...
  const added = await assess(
    [row("sample-large", { tool: "two", requests: 400, input: 0, output: 30_000_000 })],
    { prices, stored },
  );
  assert.equal(added.rows.length, 0);
  assert.equal(added.rejected[0]?.reason, "output-per-day");

  // ...while re-sending the same bucket replaces it rather than adding to it.
  const resent = await assess(
    [row("sample-large", { tool: "one", requests: 400, input: 0, output: 30_000_000 })],
    { prices, stored },
  );
  assert.equal(resent.rows.length, 1);
  assert.equal(resent.rejected.length, 0);
});

test("spend built from input instead of output hits the cost ceiling", async () => {
  // 1.5B uncached input at $4/M is $6,000, with output nowhere near its limit.
  const result = await assess(
    [row("sample-large", { requests: 1_000, input: 1_500_000_000, output: 0 })],
    { prices },
  );

  assert.equal(result.rows.length, 0);
  assert.equal(result.rejected[0]?.reason, "cost-per-day");
});

test("more output per request than any model can write is refused", () => {
  assert.equal(
    implausible(row("sample-large", { requests: 2, input: 0, output: 5_000_000 }))?.reason,
    "output-per-request",
  );
});

test("the heaviest real day on the board passes untouched", async () => {
  // Modelled on the measured peak: 1.6B tokens, 7M of them output, ~8k requests.
  const peak = row("sample-large", {
    tool: "claude-code",
    requests: 8_000,
    input: 14_000_000,
    output: 7_000_000,
    cacheWrite5m: 35_000_000,
    cacheRead: 1_600_000_000,
  });

  const result = await assess([peak], { prices });

  assert.equal(result.rejected.length, 0);
  assert.equal(result.rows.length, 1);
  assert.equal(overDay(result.rows), null);
});

test("one model spelled several ways groups as one", () => {
  const ids = [
    "claude-opus-5-5",
    "claude-opus-5.5",
    "anthropic/claude-opus-5.5",
    "us.anthropic.claude-opus-5-5-20261001-v1:0",
  ];
  assert.deepEqual([...new Set(ids.map(canonicalModelId))], ["claude-opus-5-5"]);

  // Outside Claude the dot is the vendor's own, and is left alone.
  assert.equal(canonicalModelId("gpt-5.2"), "gpt-5.2");
});

test("a profile's model list shows one line per model, not per spelling", () => {
  const doc = (model: string, costUsd: number) => ({
    ...row(model, { tool: "claude-code", costUsd }),
    $id: model,
    userId: "u",
    updatedAt: "",
  });
  const summary = summarize([doc("claude-opus-5-5", 1140.53), doc("claude-opus-5.5", 10_000)]);

  assert.equal(summary.byModel.length, 1);
  assert.equal(summary.byModel[0]?.model, "claude-opus-5-5");
  assert.equal(summary.byModel[0]?.costUsd, 11_140.53);
});
