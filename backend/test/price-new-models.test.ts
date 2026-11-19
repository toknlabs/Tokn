import assert from "node:assert/strict";
import test from "node:test";
import type { ModelsDevCatalog } from "../../pricing/catalog.ts";
import { modelLookup, type ModelLookupIO } from "../src/refresh-pricing.ts";
import type { PriceRow } from "../src/repo/pricing.ts";

const TEN_MINUTES = 10 * 60 * 1000;

/** A catalog in which `claude-opus-9` has just been released, fast mode and all. */
const released: ModelsDevCatalog = {
  anthropic: {
    models: {
      "claude-opus-9": { cost: { input: 6, output: 30, cache_read: 0.6, cache_write: 7.5 } },
      "claude-opus-9-fast": { cost: { input: 12, output: 60 } },
    },
  },
} as ModelsDevCatalog;

const before: ModelsDevCatalog = {
  anthropic: { models: { "claude-opus-8": { cost: { input: 5, output: 25 } } } },
} as ModelsDevCatalog;

/** A stand-in server: an in-memory table that a write replaces, and a scripted models.dev. */
function server(catalogs: (ModelsDevCatalog | null | Error)[]) {
  let stored: Record<string, PriceRow> = {};
  let clock = 0;
  const asked: (string | null)[] = [];
  const writes: PriceRow[][] = [];
  let refreshing: Promise<unknown> | null = null;

  const io: ModelLookupIO = {
    async fetchCatalog(etag) {
      asked.push(etag);
      const next = catalogs.shift();
      if (next instanceof Error) throw next;
      return next ? { catalog: next, etag: `v${asked.length}` } : null;
    },
    async table() {
      return stored;
    },
    async write(rows) {
      writes.push(rows);
      stored = Object.fromEntries(rows.map((row) => [row.modelId, row]));
      return rows.length;
    },
    refreshing: () => refreshing,
    now: () => clock,
  };

  return {
    lookup: modelLookup(io),
    asked,
    writes,
    advance: (ms: number) => (clock += ms),
    startRefresh: (done: Promise<unknown>) => (refreshing = done),
  };
}

test("a model models.dev has started listing is priced on the spot, fast mode included", async () => {
  const s = server([released]);

  assert.deepEqual(await s.lookup(["claude-opus-9"]), ["claude-opus-9"]);
  assert.equal(s.writes.length, 1);

  const row = s.writes[0]!.find((r) => r.modelId === "claude-opus-9");
  assert.equal(row?.input, 6);
  assert.equal(row?.fastInput, 12);
  assert.equal(row?.fastOutput, 60);
});

test("an unchanged catalog writes nothing", async () => {
  const s = server([null]);

  assert.deepEqual(await s.lookup(["claude-opus-9"]), []);
  assert.equal(s.writes.length, 0);
});

test("a catalog without the model is read once, and asked about by its etag after that", async () => {
  const s = server([before, released]);

  assert.deepEqual(await s.lookup(["claude-opus-9"]), []);
  assert.equal(s.writes.length, 0);

  s.advance(TEN_MINUTES);
  assert.deepEqual(await s.lookup(["claude-opus-9"]), ["claude-opus-9"]);
  assert.deepEqual(s.asked, [null, "v1"]);
});

test("a model that is never in the catalog does not send every sync to models.dev", async () => {
  const s = server([before, null]);

  await s.lookup(["local-llama"]);
  await s.lookup(["local-llama"]);
  await s.lookup(["local-llama"]);
  assert.equal(s.asked.length, 1);

  s.advance(TEN_MINUTES);
  await s.lookup(["local-llama"]);
  assert.equal(s.asked.length, 2);
});

test("models.dev being down does not fail the sync", async () => {
  const s = server([new Error("HTTP 503")]);
  assert.deepEqual(await s.lookup(["claude-opus-9"]), []);
});

test("a full refresh already running is waited on instead of starting a look", async () => {
  const s = server([released]);
  s.startRefresh(Promise.resolve());

  await s.lookup(["claude-opus-9"]);
  assert.equal(s.asked.length, 0);
});
