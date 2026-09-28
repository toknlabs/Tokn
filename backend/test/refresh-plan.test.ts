import assert from "node:assert/strict";
import test from "node:test";
import { pricingRefreshPlan } from "../src/refresh-pricing.ts";

const NOW = Date.parse("2026-09-25T12:00:00.000Z");

test("an empty table is refreshed before it is served", () => {
  assert.equal(pricingRefreshPlan({ count: 0, updatedAt: null }, NOW), "empty");
});

test("a table older than a day is stale, a fresh one is left alone", () => {
  assert.equal(
    pricingRefreshPlan({ count: 700, updatedAt: "2026-09-23T12:00:00.000Z" }, NOW),
    "stale",
  );
  assert.equal(
    pricingRefreshPlan({ count: 700, updatedAt: "2026-09-25T06:00:00.000Z" }, NOW),
    null,
  );
});

test("a populated table with no timestamp is treated as stale", () => {
  assert.equal(pricingRefreshPlan({ count: 10, updatedAt: null }, NOW), "stale");
});
