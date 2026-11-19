import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildPriceTable,
  cliTuple,
  loadOverrides,
  normalizeModelId,
  type ModelsDevCatalog,
} from "./catalog.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  fs.readFileSync(path.join(here, "fixtures", "catalog.json"), "utf8"),
) as ModelsDevCatalog;

test("normalize strips provider, date, and version noise and keeps a leading tilde", () => {
  assert.equal(normalizeModelId("Sample-Small"), "sample-small");
  assert.equal(normalizeModelId("openai/sample-small"), "sample-small");
  assert.equal(normalizeModelId("sample-large-20260922"), "sample-large");
  assert.equal(normalizeModelId("sample-large@eu"), "sample-large");
  assert.equal(normalizeModelId("global.openai.sample-small"), "openai.sample-small");
  assert.equal(normalizeModelId("~openai/sample-latest"), "~openai/sample-latest");
});

test("first provider wins, free models are dropped, and an unlisted reseller is ignored", () => {
  const rows = new Map(buildPriceTable(fixture, {}).map((row) => [row.modelId, row]));

  const small = rows.get("sample-small");
  assert.ok(small);
  assert.equal(small.provider, "openai");
  assert.deepEqual(cliTuple(small), [1.25, 3.5, 0.125, 1.5625]);

  const large = rows.get("sample-large");
  assert.ok(large);
  assert.deepEqual(cliTuple(large), [4, 16, 0.4, 5]);

  const alias = rows.get("~openai/sample-latest");
  assert.ok(alias);
  assert.equal(alias.provider, "openrouter");
  assert.notEqual(alias.modelId, "sample-small");

  const regional = rows.get("openai.sample-small");
  assert.ok(regional);
  assert.equal(regional.provider, "amazon-bedrock");

  assert.equal(rows.has("sample-free"), false);
  assert.equal(rows.has("only-on-reseller"), false);
});

test("overrides patch cache and fast fields without replacing catalog rates", () => {
  const rows = new Map(
    buildPriceTable(
      {
        anthropic: {
          models: {
            "claude-opus-5": { cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 } },
          },
        },
      },
      loadOverrides(),
    ).map((row) => [row.modelId, row]),
  );
  const opus = rows.get("claude-opus-5");
  assert.ok(opus);
  assert.equal(opus.input, 5);
  assert.equal(opus.output, 25);
  assert.equal(opus.cacheWrite1h, 10);
  assert.equal(opus.fastInput, 10);
  assert.equal(opus.fastOutput, 50);
});

test("fast mode comes from the catalog's -fast variant, and an override still wins", () => {
  const rows = new Map(
    buildPriceTable(
      {
        anthropic: {
          models: {
            // Anthropic's id is hyphenated; the catalog's fast variant is dotted.
            "claude-opus-5-5": { cost: { input: 4, output: 20 } },
            "claude-opus-5.5-fast": { cost: { input: 8, output: 40 } },
            "claude-opus-5": { cost: { input: 5, output: 25 } },
            "claude-opus-5-fast": { cost: { input: 12, output: 60 } },
          },
        },
        openai: {
          models: {
            "gpt-5.6-sol": { cost: { input: 4, output: 20 } },
            "gpt-5.6-sol-fast": { cost: { input: 8, output: 40 } },
            "gpt-6-luna": { cost: { input: 0.1, output: 0.5 } },
          },
        },
      } as ModelsDevCatalog,
      { "claude-opus-5": { fastInput: 10, fastOutput: 50 } },
    ).map((row) => [row.modelId, row]),
  );

  assert.deepEqual([rows.get("claude-opus-5-5")?.fastInput, rows.get("claude-opus-5-5")?.fastOutput], [8, 40]);
  assert.deepEqual([rows.get("gpt-5.6-sol")?.fastInput, rows.get("gpt-5.6-sol")?.fastOutput], [8, 40]);
  assert.deepEqual([rows.get("claude-opus-5")?.fastInput, rows.get("claude-opus-5")?.fastOutput], [10, 50]);
  assert.equal(rows.get("gpt-6-luna")?.fastInput, null);
});
