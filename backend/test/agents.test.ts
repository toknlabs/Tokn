import assert from "node:assert/strict";
import test from "node:test";
import { agentRowId } from "../src/ids.ts";
import {
  MAX_AGENT_MS,
  MAX_RUNS_PER_DAY,
  agentDocuments,
  normalizeAgentRow,
  normalizeAgents,
  summarizeAgents,
  upsertAgents,
  type AgentDoc,
  type AgentWriter,
} from "../src/repo/agents.ts";

/*
 * Agent runs from Eaon Desktop, without a database: the store is a map keyed
 * by document id, which is the one property that matters — a second write to
 * the same id replaces the first, the way Appwrite's upsert does.
 */

const NOW = Date.parse("2026-10-13T12:00:00.000Z");
const HOUR = 3_600_000;

function memoryWriter() {
  const rows = new Map<string, AgentDoc>();
  const calls: number[] = [];
  const write: AgentWriter = async (documents) => {
    calls.push(documents.length);
    for (const doc of documents) rows.set(doc.$id, doc);
  };
  return { rows, calls, write };
}

test("a well-formed entry is kept as sent", () => {
  assert.deepEqual(
    normalizeAgentRow({ day: "2026-10-12", tool: "eaon", runs: 3, totalMs: 5 * HOUR, longestMs: 2 * HOUR }, NOW),
    { day: "2026-10-12", tool: "eaon", runs: 3, totalMs: 5 * HOUR, longestMs: 2 * HOUR },
  );
});

test("small faults are clamped rather than refused", () => {
  assert.deepEqual(
    normalizeAgentRow({ day: "2026-10-12", tool: " EAON ", runs: 2.6, totalMs: -5, longestMs: "1000" }, NOW),
    // Rounded, floored at zero, and the total raised to cover the longest run.
    { day: "2026-10-12", tool: "eaon", runs: 3, totalMs: 1000, longestMs: 1000 },
  );
  // No tool means the only app that sends these.
  const untagged = normalizeAgentRow({ day: "2026-10-12", runs: 1, totalMs: 10, longestMs: 10 }, NOW);
  assert.equal(typeof untagged === "object" && untagged.tool, "eaon");
});

test("values that cannot be true are refused, with the reason", () => {
  const day = "2026-10-12";
  const cases: [unknown, string][] = [
    [null, "not-an-object"],
    [[1, 2], "not-an-object"],
    [{ day: "12/10/2026", runs: 1 }, "bad-day"],
    [{ day: "2026-13-45", runs: 1 }, "bad-day"],
    [{ day: "2026-10-20", runs: 1 }, "future-day"],
    [{ day, runs: "lots" }, "not-a-number"],
    [{ day, runs: Number.POSITIVE_INFINITY }, "not-a-number"],
    [{ day, runs: MAX_RUNS_PER_DAY + 1 }, "too-many-runs"],
    [{ day, runs: 1, longestMs: MAX_AGENT_MS + 1, totalMs: MAX_AGENT_MS + 1 }, "run-too-long"],
    [{ day, runs: 0, totalMs: 1000 }, "time-without-runs"],
    [{ day, runs: 2, totalMs: 2 * MAX_AGENT_MS + 1, longestMs: HOUR }, "total-too-long"],
  ];
  for (const [input, reason] of cases) {
    assert.equal(normalizeAgentRow(input, NOW), reason, JSON.stringify(input));
  }
});

test("the limits themselves are allowed", () => {
  const row = normalizeAgentRow(
    { day: "2026-10-12", runs: MAX_RUNS_PER_DAY, totalMs: MAX_AGENT_MS, longestMs: MAX_AGENT_MS },
    NOW,
  );
  assert.equal(typeof row, "object");
  // Tomorrow is allowed: the reporter's day can be ahead of the server's.
  assert.equal(typeof normalizeAgentRow({ day: "2026-10-14", runs: 1 }, NOW), "object");
});

test("a day sent twice keeps its last copy, and refusals are listed", () => {
  const { rows, rejected } = normalizeAgents(
    [
      { day: "2026-10-10", tool: "eaon", runs: 1, totalMs: 10, longestMs: 10 },
      { day: "2026-10-11", tool: "eaon", runs: 4, totalMs: 40, longestMs: 20 },
      { day: "2026-10-10", tool: "eaon", runs: 2, totalMs: 30, longestMs: 25 },
      { day: "2026-10-11", tool: "eaon", runs: 999_999 },
    ],
    NOW,
  );

  assert.equal(rows.length, 2);
  assert.deepEqual(
    rows.find((row) => row.day === "2026-10-10"),
    { day: "2026-10-10", tool: "eaon", runs: 2, totalMs: 30, longestMs: 25 },
  );
  assert.deepEqual(rejected, [{ day: "2026-10-11", tool: "eaon", reason: "too-many-runs" }]);
});

test("row ids are a pure function of (user, day, tool)", () => {
  const a = agentRowId("usr_alex", "2026-10-12", "eaon");
  assert.equal(a, agentRowId("usr_alex", "2026-10-12", "eaon"));
  assert.notEqual(a, agentRowId("usr_alex", "2026-10-13", "eaon"));
  assert.notEqual(a, agentRowId("usr_sam", "2026-10-12", "eaon"));
  assert.notEqual(a, agentRowId("usr_alex", "2026-10-12", "other"));
  assert.ok(a.length <= 36 && /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(a));

  const [doc] = agentDocuments("usr_alex", [{ day: "2026-10-12", tool: "eaon", runs: 1, totalMs: 5, longestMs: 5 }]);
  assert.equal(doc?.$id, a);
  assert.equal(doc?.userId, "usr_alex");
});

test("re-syncing replaces a day instead of adding to it", async () => {
  const store = memoryWriter();
  const first = normalizeAgents(
    [
      { day: "2026-10-11", tool: "eaon", runs: 3, totalMs: 3 * HOUR, longestMs: 2 * HOUR },
      { day: "2026-10-12", tool: "eaon", runs: 1, totalMs: HOUR, longestMs: HOUR },
    ],
    NOW,
  );
  await upsertAgents("usr_alex", first.rows, store.write);

  // The app's next sync: the 12th has grown, the 11th is unchanged.
  const second = normalizeAgents(
    [
      { day: "2026-10-11", tool: "eaon", runs: 3, totalMs: 3 * HOUR, longestMs: 2 * HOUR },
      { day: "2026-10-12", tool: "eaon", runs: 5, totalMs: 4 * HOUR, longestMs: 2.5 * HOUR },
    ],
    NOW,
  );
  await upsertAgents("usr_alex", second.rows, store.write);
  // And a replay of the same upload changes nothing.
  await upsertAgents("usr_alex", second.rows, store.write);

  assert.equal(store.rows.size, 2);
  const summary = summarizeAgents([...store.rows.values()]);
  assert.equal(summary.runs, 8);
  assert.equal(summary.totalMs, 7 * HOUR);
  assert.equal(summary.longestMs, 2.5 * HOUR);
  assert.equal(summary.activeDays, 2);
});

test("large uploads are written in bounded batches", async () => {
  const store = memoryWriter();
  const entries = Array.from({ length: 250 }, (_, index) => {
    const day = new Date(NOW - index * 86_400_000).toISOString().slice(0, 10);
    return { day, tool: "eaon", runs: 1, totalMs: 1000, longestMs: 1000 };
  });
  const { rows } = normalizeAgents(entries, NOW);
  const written = await upsertAgents("usr_alex", rows, store.write);

  assert.equal(written, 250);
  assert.deepEqual(store.calls, [100, 100, 50]);
});

test("the summary folds tools together per day and ignores empty days", () => {
  const summary = summarizeAgents([
    { day: "2026-10-12", runs: 2, totalMs: 100, longestMs: 80 },
    { day: "2026-10-12", runs: 1, totalMs: 300, longestMs: 300 },
    { day: "2026-10-10", runs: 0, totalMs: 0, longestMs: 0 },
  ]);
  assert.equal(summary.activeDays, 1);
  assert.deepEqual(summary.byDay, [
    { day: "2026-10-10", runs: 0, totalMs: 0, longestMs: 0 },
    { day: "2026-10-12", runs: 3, totalMs: 400, longestMs: 300 },
  ]);
});
