import assert from "node:assert/strict";
import test from "node:test";
import { computeCost, lookupPrice, normalizeModel } from "../src/core/pricing.js";

test("normalize strips provider, date, and version noise and keeps tilde aliases", () => {
  assert.equal(normalizeModel("gpt-6-luna"), "gpt-6-luna");
  assert.equal(normalizeModel("openai/gpt-6-luna"), "gpt-6-luna");
  assert.equal(normalizeModel("gpt-6-sol-20260922"), "gpt-6-sol");
  assert.equal(normalizeModel("claude-haiku-4-5-20251001"), "claude-haiku-4-5");
  assert.equal(normalizeModel("~openai/gpt-luna-latest"), "~openai/gpt-luna-latest");
});

test("built-in catalog prices current frontier ids, including prefixed spellings", () => {
  const luna = lookupPrice("gpt-6-luna");
  const prefixed = lookupPrice("openai/gpt-6-luna");
  const sol = lookupPrice("GPT-6-Sol");
  const alias = lookupPrice("~openai/gpt-luna-latest");

  assert.deepEqual(luna, { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 });
  assert.deepEqual(prefixed, luna);
  assert.deepEqual(sol, { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 });
  assert.ok(alias);
  assert.equal(alias.input, 0.1);
  assert.equal(alias.output, 0.5);
});

test("a million input tokens of a catalog model costs its published input rate", () => {
  const cost = computeCost("gpt-6-luna", {
    input: 1_000_000,
    output: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
  });
  assert.equal(cost?.input, 0.1);
  assert.equal(cost?.total, 0.1);
});

test("fast mode still comes from the shared override file", () => {
  const opus = lookupPrice("claude-opus-5");
  assert.deepEqual(opus?.fast, { input: 10, output: 50 });
  assert.equal(opus?.cacheWrite1h, 10);
});
