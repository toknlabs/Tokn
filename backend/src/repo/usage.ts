import { db, DB_ID, Query } from "../client.ts";
import { usageRowId } from "../ids.ts";
import { normalizeModelId } from "../../../pricing/catalog.ts";

/**
 * Usage storage — the heart of the backend.
 *
 * `tokn sync` re-uploads the user's entire history on every run, by design:
 * that is what makes backfills and corrections self-healing. The whole
 * correctness of the leaderboard therefore rests on one property — **writes
 * must replace, never accumulate**. Row ids are a pure function of
 * (user, day, tool, model, fast), so re-syncing the same day overwrites the
 * same rows. If ids were random, a second sync would double every number.
 */

export interface SyncRow {
  day: string;
  tool: string;
  model: string;
  fast: boolean;
  requests: number;
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  costUsd: number;
}

export interface UsageDoc extends SyncRow {
  $id: string;
  userId: string;
  updatedAt: string;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** Appwrite caps a bulk write; stay well inside it. */
const BATCH = 100;

/**
 * How many rows to pull per read.
 *
 * Reads and writes have completely different ceilings, and using the write
 * batch for both was costing whole seconds on every page view: 2,120 rows at
 * 100 a page is 22 *sequential* round trips, ~4.5s, because each one has to
 * finish before the cursor for the next is known. The same rows come back in
 * ~0.4s when asked for in one go.
 *
 * Measured against this database: limit 100 → 212ms/page, 1000 → 291ms,
 * 5000 → 414ms for everything. A thousand keeps the per-request payload
 * sensible while cutting the round trips by an order of magnitude.
 */
const READ_PAGE = 1000;

/**
 * Coerce one uploaded row, dropping anything malformed rather than failing the
 * whole sync — one odd line in a session log should not cost someone their
 * entire scan.
 */
export function normalizeRow(value: unknown): SyncRow | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;

  const day = typeof row.day === "string" ? row.day : "";
  const model = typeof row.model === "string" ? row.model.trim().toLowerCase() : "";
  // Older CLIs predate the tool dimension; attribute those to Claude Code
  // rather than rejecting the upload.
  const tool =
    typeof row.tool === "string" && row.tool.trim().length > 0
      ? row.tool.trim().toLowerCase().slice(0, 32)
      : "claude-code";

  if (!DAY_RE.test(day) || model.length === 0 || model.length > 120) return null;

  // A day in the future means a skewed clock, not real usage.
  if (day > new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)) return null;

  const int = (key: string): number => {
    const raw = row[key];
    const parsed = typeof raw === "number" ? raw : Number(raw ?? 0);
    return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
  };

  const costRaw = typeof row.costUsd === "number" ? row.costUsd : Number(row.costUsd ?? 0);
  const costUsd = Number.isFinite(costRaw) && costRaw > 0 ? costRaw : 0;

  const normalized: SyncRow = {
    day,
    tool,
    model,
    fast: row.fast === true,
    requests: int("requests"),
    input: int("input"),
    output: int("output"),
    cacheWrite5m: int("cacheWrite5m"),
    cacheWrite1h: int("cacheWrite1h"),
    cacheRead: int("cacheRead"),
    costUsd,
  };

  // An all-zero row carries nothing and would show as a phantom active day.
  const tokens =
    normalized.input +
    normalized.output +
    normalized.cacheWrite5m +
    normalized.cacheWrite1h +
    normalized.cacheRead;
  if (normalized.requests === 0 && normalized.costUsd === 0 && tokens === 0) return null;

  return normalized;
}

/**
 * Write a batch of rows for one user.
 *
 * Uses Appwrite's bulk upsert so a full history lands in a handful of round
 * trips rather than one per row.
 */
export async function upsertUsage(userId: string, rows: SyncRow[]): Promise<number> {
  if (rows.length === 0) return 0;

  const now = new Date().toISOString();
  const documents = rows.map((row) => ({
    $id: usageRowId(userId, row.day, row.tool, row.model, row.fast),
    userId,
    day: row.day,
    tool: row.tool,
    model: row.model,
    fast: row.fast,
    requests: row.requests,
    input: row.input,
    output: row.output,
    cacheWrite5m: row.cacheWrite5m,
    cacheWrite1h: row.cacheWrite1h,
    cacheRead: row.cacheRead,
    costUsd: row.costUsd,
    updatedAt: now,
  }));

  let written = 0;
  for (let i = 0; i < documents.length; i += BATCH) {
    const chunk = documents.slice(i, i + BATCH);
    await db().upsertDocuments(DB_ID, "usage_daily", chunk as never);
    written += chunk.length;
  }

  // Dropped after the write, not before: clearing first leaves a window

  // where a concurrent read repopulates the memo with pre-write rows and

  // the sync appears not to have happened.

  clearUsageCache(userId);

  return written;
}

/** Every usage row for a user, paged through in full. */
/**
 * One user's rows, memoised briefly.
 *
 * A profile render asks for the same rows three times: `userStats` for the
 * charts, `anatomyFor` for the cost split, and `whatIf` for the model
 * comparison. Each was a separate paged read of the same documents, so a
 * profile with 142 rows billed 426 reads to draw one page.
 *
 * The window only has to outlive a single render, which is milliseconds. It is
 * deliberately shorter than the pricing memo next door: a sync writes rows and
 * then refreshes totals, and a profile opened immediately afterwards should
 * not be looking at a cached copy from before the write.
 *
 * The promise is cached rather than its result, so three concurrent callers
 * share one in-flight read instead of starting three.
 */
const USAGE_TTL_MS = 3_000;
const usageCache = new Map<string, { at: number; rows: Promise<UsageDoc[]> }>();

export async function listUsage(
  userId: string,
  options: { since?: string } = {},
): Promise<UsageDoc[]> {
  const key = `${userId}:${options.since ?? ""}`;
  const hit = usageCache.get(key);
  if (hit && Date.now() - hit.at < USAGE_TTL_MS) return hit.rows;

  const rows = readUsage(userId, options);
  usageCache.set(key, { at: Date.now(), rows });
  // A rejected read must not be served to the next caller as a cached failure.
  rows.catch(() => usageCache.delete(key));

  // Bounded: one entry per user per window, cleared as entries go stale.
  if (usageCache.size > 200) {
    const cutoff = Date.now() - USAGE_TTL_MS;
    for (const [k, v] of usageCache) if (v.at < cutoff) usageCache.delete(k);
  }

  return rows;
}

/** Drop a user's memo, so a write is visible to the next read. */
export function clearUsageCache(userId?: string): void {
  if (!userId) return usageCache.clear();
  for (const key of usageCache.keys()) {
    if (key.startsWith(`${userId}:`)) usageCache.delete(key);
  }
}

async function readUsage(
  userId: string,
  options: { since?: string } = {},
): Promise<UsageDoc[]> {
  const out: UsageDoc[] = [];
  let cursor: string | undefined;

  for (;;) {
    const queries = [Query.equal("userId", userId), Query.limit(READ_PAGE), Query.orderAsc("$id")];
    if (options.since) queries.push(Query.greaterThanEqual("day", options.since));
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const page = await db().listDocuments(DB_ID, "usage_daily", queries);
    const docs = page.documents as unknown as UsageDoc[];
    out.push(...docs);

    if (docs.length < READ_PAGE) break;
    cursor = docs[docs.length - 1]?.$id;
    if (!cursor) break;
  }

  return out;
}

/**
 * Every usage row across all users.
 *
 * Appwrite has no `GROUP BY` or `SUM`, so board-wide aggregation happens in
 * memory over this. That is fine at current scale and explicitly is not a
 * long-term plan: past a few thousand active users the leaderboard should read
 * the `user_totals` rollup instead, which is exactly what it exists for.
 */
export async function listAllUsage(options: { since?: string; until?: string } = {}): Promise<
  UsageDoc[]
> {
  const out: UsageDoc[] = [];
  let cursor: string | undefined;

  for (;;) {
    const queries = [Query.limit(READ_PAGE), Query.orderAsc("$id")];
    if (options.since) queries.push(Query.greaterThanEqual("day", options.since));
    if (options.until) queries.push(Query.lessThanEqual("day", options.until));
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const page = await db().listDocuments(DB_ID, "usage_daily", queries);
    const docs = page.documents as unknown as UsageDoc[];
    out.push(...docs);

    if (docs.length < READ_PAGE) break;
    cursor = docs[docs.length - 1]?.$id;
    if (!cursor) break;
  }

  return out;
}

export interface UsageSummary {
  costUsd: number;
  tokens: number;
  requests: number;
  activeDays: number;
  costUsd7d: number;
  costUsd30d: number;
  firstDay: string | null;
  lastDay: string | null;
  topModel: string | null;
  topTool: string | null;
  toolCount: number;
  byDay: { day: string; costUsd: number; tokens: number; requests: number }[];
  byModel: { model: string; costUsd: number; tokens: number; requests: number }[];
  byTool: { tool: string; costUsd: number; tokens: number; requests: number }[];
  /** Aggregate cache traffic, for the reuse comparison. */
  cacheRead: number;
  cacheWrite: number;
}

const tokensOf = (row: SyncRow): number =>
  row.input + row.output + row.cacheWrite5m + row.cacheWrite1h + row.cacheRead;

/**
 * One id per model, for grouping usage on a page.
 *
 * The same model arrives spelled several ways: Claude Code writes
 * `claude-opus-5-5`, Copilot and OpenRouter write `claude-opus-5.5`, Bedrock
 * adds region prefixes, some logs keep the dated snapshot. Grouped as raw
 * strings, one model shows up as two lines with the same label.
 *
 * Display only. A stored row keeps the id it arrived with, because its row id
 * is derived from it: rewriting it would orphan every existing row, and the
 * next sync would count them twice.
 */
export function canonicalModelId(model: string): string {
  const id = normalizeModelId(model);
  // Only Claude ids are folded. Anthropic's own spelling is hyphens, so a
  // dotted Claude id is always someone's rewrite of it. Elsewhere the dot is
  // the vendor's own (`gpt-5.2`) and a hyphen could mean something else.
  return id.startsWith("claude-") ? id.replace(/\./g, "-") : id;
}

/** Roll a user's raw rows into the shape both the profile page and the totals table need. */
export function summarize(rows: UsageDoc[]): UsageSummary {
  const days = new Map<string, { costUsd: number; tokens: number; requests: number }>();
  const models = new Map<string, { costUsd: number; tokens: number; requests: number }>();
  const tools = new Map<string, { costUsd: number; tokens: number; requests: number }>();

  let costUsd = 0;
  let tokens = 0;
  let requests = 0;
  let cacheRead = 0;
  let cacheWrite = 0;

  const bump = (
    map: Map<string, { costUsd: number; tokens: number; requests: number }>,
    key: string,
    row: UsageDoc,
  ) => {
    const entry = map.get(key) ?? { costUsd: 0, tokens: 0, requests: 0 };
    entry.costUsd += row.costUsd;
    entry.tokens += tokensOf(row);
    entry.requests += row.requests;
    map.set(key, entry);
  };

  for (const row of rows) {
    costUsd += row.costUsd;
    tokens += tokensOf(row);
    requests += row.requests;
    cacheRead += row.cacheRead;
    cacheWrite += row.cacheWrite5m + row.cacheWrite1h;
    bump(days, row.day, row);
    bump(models, canonicalModelId(row.model), row);
    bump(tools, row.tool, row);
  }

  const dayKeys = [...days.keys()].sort();
  const cutoff = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() - (n - 1));
    return d.toISOString().slice(0, 10);
  };
  const since7 = cutoff(7);
  const since30 = cutoff(30);

  const sumSince = (from: string) =>
    [...days.entries()].reduce((sum, [day, v]) => (day >= from ? sum + v.costUsd : sum), 0);

  const rank = (map: Map<string, { costUsd: number; tokens: number; requests: number }>) =>
    [...map.entries()].sort((a, b) => b[1].costUsd - a[1].costUsd || b[1].tokens - a[1].tokens);

  const rankedModels = rank(models);
  const rankedTools = rank(tools);

  return {
    costUsd,
    tokens,
    requests,
    activeDays: dayKeys.length,
    costUsd7d: sumSince(since7),
    costUsd30d: sumSince(since30),
    firstDay: dayKeys[0] ?? null,
    lastDay: dayKeys[dayKeys.length - 1] ?? null,
    topModel: rankedModels[0]?.[0] ?? null,
    topTool: rankedTools[0]?.[0] ?? null,
    toolCount: tools.size,
    byDay: dayKeys.map((day) => ({ day, ...days.get(day)! })),
    byModel: rankedModels.map(([model, v]) => ({ model, ...v })),
    byTool: rankedTools.map(([tool, v]) => ({ tool, ...v })),
    cacheRead,
    cacheWrite,
  };
}

/** Delete every usage row for a user — used when an account is removed. */
export async function deleteUsage(userId: string): Promise<number> {
  const rows = await listUsage(userId);
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH).map((r) => r.$id);
    await db().deleteDocuments(DB_ID, "usage_daily", [Query.equal("$id", chunk)]);
  }
  return rows.length;
}
