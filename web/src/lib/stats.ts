import "server-only";
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { PROFILES_TAG, USAGE_TAG } from "./board-cache";
import {
  listAgents,
  listAllAgents,
  listAllProfiles,
  listAllUsage,
  listAllUserTotals,
  listDevices,
  listUsage,
  listedFor,
  summarizeAgents,
  type AgentDoc,
  type AgentSummary,
  type Profile,
  type Totals,
  type UsageDoc,
} from "./backend";
import {
  fixtureAgents,
  fixtureProfiles,
  fixtureSnapshotSource,
  fixtureUsage,
  fixturesOn,
} from "./fixtures";

/**
 * Every read the pages make — backed by Appwrite.
 *
 * Appwrite has no `GROUP BY` and no `SUM`, so the aggregation that used to be
 * SQL now happens here in memory over the raw rows. Two consequences worth
 * knowing:
 *
 *   - Board-wide functions work from a snapshot of every usage row, folded
 *     to (user, day, model) and refreshed hourly. See the cache section.
 *   - A profile page reads only that person's rows, directly and uncached, so
 *     a sync shows there at once.
 *
 * Days are plain `YYYY-MM-DD` strings in the reporter's own timezone, which is
 * what the CLI uploads. Comparing them as strings is therefore correct.
 *
 * Exported names and shapes match the SQLite layer this replaced; the only
 * change for callers is that the data functions are now async.
 */

export type Period = "day" | "week" | "month" | "year" | "all";

export const PERIODS: { key: Period; label: string }[] = [
  { key: "day", label: "day" },
  { key: "week", label: "week" },
  { key: "month", label: "month" },
  { key: "year", label: "3 months" },
  { key: "all", label: "all time" },
];

export function isPeriod(value: string | undefined): value is Period {
  return (
    value === "day" ||
    value === "week" ||
    value === "month" ||
    value === "year" ||
    value === "all"
  );
}

export function today(): string {
  return toDay(new Date());
}

export function toDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return toDay(date);
}

/** Inclusive lower bound for a period, or null for all-time. */
export function periodStart(period: Period, from = today()): string | null {
  switch (period) {
    case "day":
      return from;
    case "week":
      return shiftDay(from, -6);
    case "month":
      return shiftDay(from, -29);
    case "year":
      return shiftDay(from, -89);
    case "all":
      return null;
  }
}

/* ------------------------------------------------------------------ cache */

/**
 * The board runs on a snapshot that refreshes on the hour.
 *
 * A sync shows on the syncing person's own pages the moment it lands, because
 * those read their rows directly (`userStats`, `getTotals`). The board is
 * slower on purpose. It is rebuilt once an hour, so everyone sees ranks move
 * at the same time instead of watching them reshuffle every few seconds, and a
 * page view costs no database reads.
 *
 * Numbers and identity are cached separately:
 *
 *   - Spend, tokens and requests follow the hourly snapshot.
 *   - Profiles (handles, names, who is private or unlisted) are cleared the
 *     moment one changes (`board-cache.ts`). Someone who hides their account
 *     has to leave the board now, not at the next hour.
 *
 * Nothing here may be nested inside another `unstable_cache`: Next skips the
 * cache for nested calls, so a cached wrapper around these would quietly run
 * every read underneath it on each refresh.
 */
export const BOARD_REFRESH_SECONDS = 3_600;

/**
 * How far back of the day's scan to look for syncs. Covers clock drift between
 * the instance that took the scan and the one that stamped `lastSyncAt`.
 */
const SYNC_SKEW_MS = 10 * 60_000;

/**
 * Where a warning is logged. The data cache refuses entries over 2MB and says
 * so only in the logs, after which every view would read the table again.
 * The raw rows passed that limit at a few thousand rows, which is how the
 * previous version of this cache ended up never storing anything.
 */
const CACHE_WARN_BYTES = 1_500_000;

/**
 * One user's usage for one (day, model), with tool and fast mode folded in.
 *
 * Tuples rather than objects, and model names stored once: the board needs
 * nothing finer than this, and the raw documents are about fifteen times the
 * size.
 */
type Cell = [day: string, model: number, cost: number, tokens: number, requests: number];

/**
 * An Eaon Desktop cell: a `Cell` plus the day's tokens by kind, which the
 * Eaon site's ratios (cache hit rate, output share) are made of. Only Eaon's
 * rows carry the split, so the main board's snapshot stays the size it was.
 */
type EaonCell = [
  day: string,
  model: number,
  cost: number,
  tokens: number,
  requests: number,
  input: number,
  output: number,
  cacheRead: number,
  cacheWrite: number,
];

/** One user's agent runs for one day, tools folded together. */
type AgentCell = [day: string, runs: number, totalMs: number, longestMs: number];

/**
 * The usage `tool` Eaon Desktop reports under. Its board is the same snapshot
 * filtered to this tool, so it costs no reads of its own.
 */
export const EAON_TOOL = "eaon";

interface UsageSlice {
  /** When the reads began. A sync that lands after this is not in it. */
  capturedAt: string;
  models: string[];
  users: Record<string, Cell[]>;
  /**
   * The same cells again, for Eaon Desktop's rows only. The main board folds
   * the tool away, and the Eaon board is exactly the part it folds.
   */
  eaon: Record<string, EaonCell[]>;
  /** Agent runs per user per day. One row per active day, so it stays small. */
  agents: Record<string, AgentCell[]>;
}

type TotalsRow = Pick<
  Totals,
  "userId" | "costUsd" | "tokens" | "requests" | "activeDays" | "topModel" | "lastDay"
>;

interface Delta {
  capturedAt: string;
  totals: TotalsRow[];
  /** Everyone re-read for this delta, including anyone now with no rows. */
  changed: string[];
  usage: UsageSlice;
}

const tokensOf = (row: UsageDoc): number =>
  row.input + row.output + row.cacheWrite5m + row.cacheWrite1h + row.cacheRead;

export function compactUsage(
  rows: UsageDoc[],
  capturedAt: string,
  agentRows: Pick<AgentDoc, "userId" | "day" | "runs" | "totalMs" | "longestMs">[] = [],
): UsageSlice {
  const models: string[] = [];
  const modelIndex = new Map<string, number>();
  const cells = new Map<string, Cell>();
  const eaonCells = new Map<string, EaonCell>();
  const users: Record<string, Cell[]> = {};
  const eaon: Record<string, EaonCell[]> = {};

  const fold = (row: UsageDoc, model: number) => {
    const key = `${row.userId}|${row.day}|${model}`;
    const hit = cells.get(key);
    if (hit) {
      hit[2] += row.costUsd;
      hit[3] += tokensOf(row);
      hit[4] += row.requests;
      return;
    }

    const cell: Cell = [row.day, model, row.costUsd, tokensOf(row), row.requests];
    cells.set(key, cell);
    (users[row.userId] ??= []).push(cell);
  };

  const foldEaon = (row: UsageDoc, model: number) => {
    const key = `${row.userId}|${row.day}|${model}`;
    const write = row.cacheWrite5m + row.cacheWrite1h;
    const hit = eaonCells.get(key);
    if (hit) {
      hit[2] += row.costUsd;
      hit[3] += tokensOf(row);
      hit[4] += row.requests;
      hit[5] += row.input;
      hit[6] += row.output;
      hit[7] += row.cacheRead;
      hit[8] += write;
      return;
    }

    const cell: EaonCell = [row.day, model, row.costUsd, tokensOf(row), row.requests, row.input, row.output, row.cacheRead, write];
    eaonCells.set(key, cell);
    (eaon[row.userId] ??= []).push(cell);
  };

  for (const row of rows) {
    let model = modelIndex.get(row.model);
    if (model === undefined) {
      model = models.length;
      models.push(row.model);
      modelIndex.set(row.model, model);
    }

    fold(row, model);
    if (row.tool === EAON_TOOL) foldEaon(row, model);
  }

  const agentCells = new Map<string, AgentCell>();
  const agents: Record<string, AgentCell[]> = {};
  for (const row of agentRows) {
    const key = `${row.userId}|${row.day}`;
    const hit = agentCells.get(key);
    if (hit) {
      hit[1] += row.runs;
      hit[2] += row.totalMs;
      hit[3] = Math.max(hit[3], row.longestMs);
      continue;
    }
    const cell: AgentCell = [row.day, row.runs, row.totalMs, row.longestMs];
    agentCells.set(key, cell);
    (agents[row.userId] ??= []).push(cell);
  }

  return { capturedAt, models, users, eaon, agents };
}

function warnIfLarge(label: string, value: unknown): void {
  const bytes = JSON.stringify(value).length;
  if (bytes > CACHE_WARN_BYTES) {
    console.warn(
      `[board] ${label} is ${bytes} bytes. The data cache stores nothing over 2MB, ` +
        `so past that every board view reads usage_daily in full.`,
    );
  }
}

/**
 * Every usage row, folded down: the one expensive read, a document per row.
 *
 * It runs once a day and is served stale while it refreshes, so no visitor
 * waits on it after the first. Syncs since it was taken are layered on top by
 * the hourly delta, which is what keeps it correct between refreshes.
 */
const cachedUsageBase = unstable_cache(
  async (): Promise<UsageSlice> => {
    const capturedAt = new Date().toISOString();
    const [usage, agents] = await Promise.all([listAllUsage(), listAllAgents()]);
    const slice = compactUsage(usage, capturedAt, agents);
    warnIfLarge("usage snapshot", slice);
    return slice;
  },
  // Versioned with the slice's shape: an entry cached before the Eaon cells
  // existed would otherwise be served for up to a day with none in it.
  ["board:usage-base:v3"],
  { revalidate: 86_400, tags: [USAGE_TAG] },
);

/**
 * The hour's changes: the rollup (one row per user), plus the full rows of
 * everyone whose rollup says they synced since the base was taken.
 *
 * Keyed by the hour, so it is rebuilt at most once an hour and never served
 * from an earlier one, and by the base it sits on, so a fresh base gets a
 * fresh delta.
 */
const cachedUsageDelta = unstable_cache(
  async (_hour: number, since: string): Promise<Delta> => {
    const capturedAt = new Date().toISOString();
    const totals = await listAllUserTotals();
    const changed = totals
      .filter((row) => row.lastSyncAt && row.lastSyncAt >= since)
      .map((row) => row.userId);
    const [rows, agents] = await Promise.all([
      Promise.all(changed.map((userId) => listUsage(userId))).then((all) => all.flat()),
      Promise.all(changed.map((userId) => listAgents(userId))).then((all) => all.flat()),
    ]);

    return {
      capturedAt,
      totals: totals.map((row) => ({
        userId: row.userId,
        costUsd: row.costUsd,
        tokens: row.tokens,
        requests: row.requests,
        activeDays: row.activeDays,
        topModel: row.topModel ?? null,
        lastDay: row.lastDay ?? null,
      })),
      changed,
      usage: compactUsage(rows, capturedAt, agents),
    };
  },
  ["board:usage-delta:v3"],
  { revalidate: BOARD_REFRESH_SECONDS * 2 },
);

/** Every profile. Cleared on any change to one, with an hourly backstop. */
const storedProfiles = unstable_cache(async () => listAllProfiles(), ["board:profiles"], {
  revalidate: BOARD_REFRESH_SECONDS,
  tags: [PROFILES_TAG],
});

/** The profile list, or the dev fixtures when those are switched on. */
const cachedProfiles = async (): Promise<Profile[]> =>
  fixturesOn() ? fixtureProfiles() : storedProfiles();

const currentHour = (): number => Math.floor(Date.now() / (BOARD_REFRESH_SECONDS * 1000));

interface BoardRow {
  userId: string;
  day: string;
  model: string;
  cost: number;
  tokens: number;
  requests: number;
}

/** An Eaon Desktop row, with its tokens by kind. */
export interface EaonBoardRow extends BoardRow {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface AgentBoardRow {
  userId: string;
  day: string;
  runs: number;
  totalMs: number;
  longestMs: number;
}

interface Snapshot {
  /** When the numbers on the board were read. */
  updatedAt: string;
  rows: BoardRow[];
  /** Eaon Desktop's share of `rows`. */
  eaonRows: EaonBoardRow[];
  agents: AgentBoardRow[];
  totals: TotalsRow[];
}

/** The decoded snapshot, kept while its two halves are unchanged. */
let decoded: { key: string; snapshot: Snapshot } | null = null;

/**
 * The board's numbers: the daily base with the hour's delta over it.
 *
 * Wrapped in React's `cache` so the half-dozen calls one page render makes
 * share a single fetch from the data cache.
 */
const snapshot = cache(async (): Promise<Snapshot> => {
  // Dev only: a fixed cast of placeholder accounts, so the board can be seen
  // without a database. `fixturesOn` is false in every production build.
  if (fixturesOn()) {
    const source = fixtureSnapshotSource();
    const key = `fixtures|${source.capturedAt}`;
    if (decoded?.key === key) return decoded.snapshot;
    const base = compactUsage(source.usage, source.capturedAt, source.agents);
    const empty = compactUsage([], source.capturedAt);
    const next = decode(base, {
      capturedAt: source.capturedAt,
      totals: source.totals,
      changed: [],
      usage: empty,
    });
    decoded = { key, snapshot: next };
    return next;
  }

  const base = await cachedUsageBase();
  const since = new Date(Date.parse(base.capturedAt) - SYNC_SKEW_MS).toISOString();
  const delta = await cachedUsageDelta(currentHour(), since);

  const key = `${base.capturedAt}|${delta.capturedAt}`;
  if (decoded?.key === key) return decoded.snapshot;

  const next = decode(base, delta);
  decoded = { key, snapshot: next };
  return next;
});

/** The base with the delta laid over it, as plain rows. */
function decode(base: UsageSlice, delta: Delta): Snapshot {
  const rows: BoardRow[] = [];
  const eaonRows: EaonBoardRow[] = [];
  const agents: AgentBoardRow[] = [];

  const add = (slice: UsageSlice, userId: string, cells: Cell[]) => {
    for (const [day, model, cost, tokens, requests] of cells) {
      rows.push({ userId, day, model: slice.models[model] ?? "unknown", cost, tokens, requests });
    }
  };
  const addEaon = (slice: UsageSlice, userId: string, cells: EaonCell[]) => {
    for (const [day, model, cost, tokens, requests, input = 0, output = 0, cacheRead = 0, cacheWrite = 0] of cells) {
      eaonRows.push({ userId, day, model: slice.models[model] ?? "unknown", cost, tokens, requests, input, output, cacheRead, cacheWrite });
    }
  };
  const addAgents = (userId: string, cells: AgentCell[]) => {
    for (const [day, runs, totalMs, longestMs] of cells) {
      agents.push({ userId, day, runs, totalMs, longestMs });
    }
  };

  // A user in the delta is replaced wholesale: syncs upsert, so their fresh
  // rows are the whole truth and the base's copy is simply older.
  const replaced = new Set(delta.changed);
  const layers: [UsageSlice, (userId: string) => boolean][] = [
    [base, (userId) => !replaced.has(userId)],
    [delta.usage, () => true],
  ];
  for (const [slice, keep] of layers) {
    for (const [userId, cells] of Object.entries(slice.users)) {
      if (keep(userId)) add(slice, userId, cells);
    }
    // `?? {}`: a slice cached by an older build has neither.
    for (const [userId, cells] of Object.entries(slice.eaon ?? {})) {
      if (keep(userId)) addEaon(slice, userId, cells);
    }
    for (const [userId, cells] of Object.entries(slice.agents ?? {})) {
      if (keep(userId)) addAgents(userId, cells);
    }
  }

  return { updatedAt: delta.capturedAt, rows, eaonRows, agents, totals: delta.totals };
}

/**
 * The Eaon Desktop part of the snapshot, with every profile, for the Eaon
 * site's own figures (lib/eaon.ts). The same cached read the boards use.
 */
export async function eaonSnapshot(): Promise<{
  updatedAt: string;
  rows: EaonBoardRow[];
  agents: AgentBoardRow[];
  profiles: Profile[];
}> {
  const [shot, profiles] = await Promise.all([snapshot(), cachedProfiles()]);
  return { updatedAt: shot.updatedAt, rows: shot.eaonRows, agents: shot.agents, profiles };
}

/** When the numbers on the board were last read, for the "updated" note. */
export async function boardUpdatedAt(): Promise<string> {
  return (await snapshot()).updatedAt;
}

/** When the board next takes in new syncs: the top of the next hour. */
export function nextBoardUpdate(): string {
  return new Date((currentHour() + 1) * BOARD_REFRESH_SECONDS * 1000).toISOString();
}

const inWindow = (
  row: { day: string },
  start: string | null,
  until?: string,
): boolean => (!start || row.day >= start) && (!until || row.day <= until);

/* ----------------------------------------------------------- leaderboard */

export type Metric = "cost" | "tokens" | "requests";

export const METRICS: { key: Metric; label: string }[] = [
  { key: "cost", label: "cost" },
  { key: "tokens", label: "tokens" },
  { key: "requests", label: "requests" },
];

export function isMetric(value: string | undefined): value is Metric {
  return value === "cost" || value === "tokens" || value === "requests";
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  handle: string;
  name: string | null;
  joined: string;
  billing: string;
  cost: number;
  tokens: number;
  requests: number;
  days: number;
  topModel: string | null;
  lastDay: string | null;
}

export interface BoardOptions {
  /** Inclusive upper bound on `day`, for reconstructing an earlier board. */
  until?: string;
  /**
   * Drop accounts with nothing in the window.
   *
   * The board proper ranks everyone who signed up, but a "top ten this month"
   * highlight is a different question, and padding it with dashes when fewer
   * than ten people were active says nothing.
   */
  activeOnly?: boolean;
  /**
   * How many ranked rows to skip, for paging.
   *
   * Ranks are assigned before the slice, so page two starts at 16 rather than
   * restarting at 1.
   */
  offset?: number;
}

/**
 * A board built from the `user_totals` rollup instead of the raw rows.
 *
 * `usage_daily` holds one row per (day, tool, model) bucket, so ranking users
 * by scanning it costs one read per bucket on every page view. At a few
 * thousand buckets that is a whole monthly read quota inside a few hundred
 * views, which is how this site went down. The rollup is one row per user and
 * is already refreshed on every sync, so the same board costs one read each.
 *
 * Only all-time is served this way. The rollup carries `costUsd7d` and
 * `costUsd30d` but no windowed token or request counts, and nothing that can
 * reconstruct an earlier board, so every other period sums the snapshot's
 * rows. Approximating them would be worse: a board is a ranking, and a ranking
 * that is quietly wrong is not worth having.
 */
async function boardFromTotals(
  metric: Metric,
  { activeOnly, offset, limit }: { activeOnly: boolean; offset: number; limit: number },
): Promise<LeaderboardEntry[]> {
  const [{ totals }, profiles] = await Promise.all([snapshot(), cachedProfiles()]);
  const byUser = new Map<string, TotalsRow>(totals.map((row) => [row.userId, row]));

  const entries: LeaderboardEntry[] = [];
  for (const profile of profiles) {
    // Same rule as the scanning path: everyone who signed up gets a row, and
    // private or opted-out accounts are not ranked.
    if (!listedFor(profile)) continue;
    const row = byUser.get(profile.$id);

    entries.push({
      rank: 0,
      userId: profile.$id,
      handle: profile.handle,
      name: profile.name ?? null,
      joined: profile.createdAt,
      billing: profile.billing,
      cost: row?.costUsd ?? 0,
      tokens: row?.tokens ?? 0,
      requests: row?.requests ?? 0,
      days: row?.activeDays ?? 0,
      topModel: row?.topModel ?? null,
      lastDay: row?.lastDay ?? null,
    });
  }

  return rankAndSlice(entries, metric, { activeOnly, offset, limit });
}

export async function leaderboard(
  period: Period,
  metric: Metric,
  limit = 100,
  { until, activeOnly = false, offset = 0 }: BoardOptions = {},
): Promise<LeaderboardEntry[]> {
  // The default view, and so nearly all traffic, crawlers included.
  if (period === "all" && !until) {
    return boardFromTotals(metric, { activeOnly, offset, limit });
  }

  const [{ rows }, profiles] = await Promise.all([snapshot(), cachedProfiles()]);
  const start = periodStart(period, until);

  interface Acc {
    cost: number;
    tokens: number;
    requests: number;
    days: Set<string>;
    lastDay: string | null;
    models: Map<string, number>;
  }

  const byUser = new Map<string, Acc>();
  const blank = (): Acc => ({
    cost: 0,
    tokens: 0,
    requests: 0,
    days: new Set(),
    lastDay: null,
    models: new Map(),
  });

  // Everyone who signed up gets a row, whether or not they have ever synced.
  // Seeding from profiles rather than from usage is the whole difference: a
  // new account is on the board from the moment it exists, at the bottom,
  // which is a truer picture of the population than hiding it until it has
  // something to report.
  //
  // Reconstructing an earlier board (`until`) only seeds accounts that already
  // existed then, so someone who joined this week is genuinely new rather than
  // apparently motionless.
  for (const profile of profiles) {
    if (!listedFor(profile)) continue;
    if (until && profile.createdAt.slice(0, 10) > until) continue;
    byUser.set(profile.$id, blank());
  }

  for (const row of rows) {
    if (!inWindow(row, start, until)) continue;

    let acc = byUser.get(row.userId);
    if (!acc) {
      // Usage with no seeded profile: deleted, private, or opted out. Skipped
      // below; the totals strip still counts it anonymously.
      acc = blank();
      byUser.set(row.userId, acc);
    }

    acc.cost += row.cost;
    acc.tokens += row.tokens;
    acc.requests += row.requests;
    acc.days.add(row.day);
    if (!acc.lastDay || row.day > acc.lastDay) acc.lastDay = row.day;
    acc.models.set(row.model, (acc.models.get(row.model) ?? 0) + row.cost);
  }

  const profileById = new Map(profiles.map((p) => [p.$id, p]));

  const entries: LeaderboardEntry[] = [];

  for (const [userId, acc] of byUser) {
    const profile = profileById.get(userId);
    // A user whose profile was deleted but whose rows survived: skip rather
    // than render a blank row.
    if (!profile) continue;
    // Private accounts, and public ones that opted out, are not ranked. Their
    // usage still counts toward the anonymous site-wide totals.
    if (!listedFor(profile)) continue;

    // Ties on spend break by model name, matching the old SQL.
    const topModel =
      [...acc.models.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )[0]?.[0] ?? null;

    entries.push({
      rank: 0,
      userId,
      handle: profile.handle,
      name: profile.name ?? null,
      joined: profile.createdAt,
      billing: profile.billing,
      cost: acc.cost,
      tokens: acc.tokens,
      requests: acc.requests,
      days: acc.days.size,
      topModel,
      lastDay: acc.lastDay,
    });
  }

  return rankAndSlice(entries, metric, { activeOnly, offset, limit });
}

/** The ordering the board has always used, shared by both read paths. */
function rankAndSlice(
  entries: LeaderboardEntry[],
  metric: Metric,
  { activeOnly, offset, limit }: { activeOnly: boolean; offset: number; limit: number },
): LeaderboardEntry[] {
  return entries
    .filter((entry) => !activeOnly || entry[metric] > 0)
    .sort(
      (a, b) =>
        b[metric] - a[metric] ||
        // Everyone yet to report ties at zero, and ordering that block by name
        // would read as a ranking it is not. Longest-standing account first is
        // at least a fact about them.
        a.joined.localeCompare(b.joined) ||
        a.handle.localeCompare(b.handle),
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }))
    .slice(offset, offset + limit);
}

/**
 * Where everyone sat on the board a week ago, so each row can show which way it
 * is moving. A week is short enough to feel live and long enough that ordinary
 * daily noise does not make every row flicker.
 */
export const MOVEMENT_LOOKBACK_DAYS = 7;

export async function previousRanks(
  period: Period,
  metric: Metric,
): Promise<Map<string, number>> {
  const until = shiftDay(today(), -MOVEMENT_LOOKBACK_DAYS);
  // Rebuilt from the snapshot in memory, which costs no reads. This used to be
  // its own `unstable_cache` around `leaderboard`, and Next skips the cache for
  // calls nested inside one, so every rebuild re-read the whole table.
  const earlier = await leaderboard(period, metric, 100_000, { until });
  return new Map(earlier.map((entry) => [entry.userId, entry.rank]));
}

/** The per-model spend split for every user, for the mix bar in each row. */
export async function modelMix(
  period: Period,
): Promise<Map<string, { model: string; cost: number }[]>> {
  const { rows } = await snapshot();
  const start = periodStart(period);

  const byUser = new Map<string, Map<string, number>>();
  for (const row of rows) {
    if (!inWindow(row, start)) continue;
    let models = byUser.get(row.userId);
    if (!models) {
      models = new Map();
      byUser.set(row.userId, models);
    }
    models.set(row.model, (models.get(row.model) ?? 0) + row.cost);
  }

  const mix = new Map<string, { model: string; cost: number }[]>();
  for (const [userId, models] of byUser) {
    mix.set(
      userId,
      [...models.entries()]
        .map(([model, cost]) => ({ model, cost }))
        .sort((a, b) => b.cost - a.cost),
    );
  }
  return mix;
}

/** A short daily-cost series per user, for the sparkline in each row. */
export async function recentSeries(days = 14): Promise<Map<string, number[]>> {
  const { rows } = await snapshot();
  const start = shiftDay(today(), -(days - 1));

  // Days with no usage have no row, and a gap would misdraw the line, so every
  // series is built over a dense window.
  const window = Array.from({ length: days }, (_, index) =>
    shiftDay(start, index),
  );
  const index = new Map(window.map((day, position) => [day, position]));

  const series = new Map<string, number[]>();
  for (const row of rows) {
    if (row.day < start) continue;
    const position = index.get(row.day);
    if (position === undefined) continue;

    let values = series.get(row.userId);
    if (!values) {
      values = new Array<number>(days).fill(0);
      series.set(row.userId, values);
    }
    values[position] = (values[position] ?? 0) + row.cost;
  }

  return series;
}

/** Percent change between the last half of a series and the half before it. */
export function trend(values: number[] | undefined): number | null {
  if (!values || values.length < 4) return null;

  const half = Math.floor(values.length / 2);
  const earlier = values.slice(0, half).reduce((sum, value) => sum + value, 0);
  const later = values.slice(half).reduce((sum, value) => sum + value, 0);

  if (earlier <= 0) return later > 0 ? 100 : null;
  return ((later - earlier) / earlier) * 100;
}

export async function rankOf(
  userId: string,
  period: Period,
  metric: Metric,
): Promise<number | null> {
  const all = await leaderboard(period, metric, 100_000);
  return all.find((entry) => entry.userId === userId)?.rank ?? null;
}

export async function totalUsers(): Promise<number> {
  return (await cachedProfiles()).length;
}

/**
 * How many accounts the board ranks — everyone signed up, less the private and
 * the opted-out. Used to say when the page is showing only the top of a longer
 * board.
 */
export async function rankedUsers(): Promise<number> {
  return (await cachedProfiles()).filter(listedFor).length;
}

export interface GlobalTotals {
  cost: number;
  tokens: number;
  requests: number;
  users: number;
}

export async function globalTotals(period: Period): Promise<GlobalTotals> {
  // All-time is the default view, and `user_totals` already holds exactly
  // these four numbers per user. Summing twenty rollup rows beats scanning
  // every usage row to add up the same figures.
  if (period === "all") {
    const { totals } = await snapshot();
    const out: GlobalTotals = { cost: 0, tokens: 0, requests: 0, users: 0 };
    for (const row of totals) {
      out.cost += row.costUsd;
      out.tokens += row.tokens;
      out.requests += row.requests;
      // The scan counted users who appear in usage, so an account that has
      // never synced is not one of them.
      if (row.requests > 0) out.users += 1;
    }
    return out;
  }

  const { rows } = await snapshot();
  const start = periodStart(period);

  const totals: GlobalTotals = { cost: 0, tokens: 0, requests: 0, users: 0 };
  const users = new Set<string>();

  for (const row of rows) {
    if (!inWindow(row, start)) continue;
    totals.cost += row.cost;
    totals.tokens += row.tokens;
    totals.requests += row.requests;
    users.add(row.userId);
  }

  totals.users = users.size;
  return totals;
}

/* --------------------------------------------------------------- profile */

export interface DayPoint {
  day: string;
  cost: number;
  tokens: number;
  requests: number;
  /**
   * The same day's tokens split by kind.
   *
   * The CLI has always uploaded this — every stored row carries the five
   * counts separately — but `byDay` used to add them together and throw the
   * breakdown away, which left every chart able to plot only money. On an
   * agent workload cache is most of the volume, so a tokens line without the
   * split hides the one thing worth seeing.
   *
   * Cache writes are combined here: the 5m/1h distinction changes the price,
   * not the shape of the day, and it is already shown where it matters in the
   * cost anatomy.
   */
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
}

export interface ModelPoint {
  model: string;
  cost: number;
  tokens: number;
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface UserStats {
  totals: { cost: number; tokens: number; requests: number; days: number };
  tokens: {
    input: number;
    output: number;
    cacheWrite: number;
    cacheRead: number;
  };
  byDay: DayPoint[];
  byModel: ModelPoint[];
  byTool: { tool: string; cost: number; tokens: number; requests: number }[];
  firstDay: string | null;
  lastDay: string | null;
  streak: number;
  longestStreak: number;
  best: DayPoint | null;
}

export async function userStats(
  userId: string,
  period: Period = "all",
  options: { tool?: string } = {},
): Promise<UserStats> {
  const start = periodStart(period);
  // One user's rows, queried directly rather than filtered out of the
  // board-wide snapshot — a profile page should not pay for everyone's data.
  // The Eaon profile passes a tool and sees only what Eaon Desktop reported.
  const rows = (await usageRows(userId)).filter(
    (row) => inWindow(row, start) && (!options.tool || row.tool === options.tool),
  );
  return statsFromRows(rows);
}

/** One user's raw rows: the database, or the dev fixtures. */
async function usageRows(userId: string): Promise<UsageDoc[]> {
  return fixturesOn() ? fixtureUsage(userId) : listUsage(userId);
}

/** Fold one user's rows into everything a profile draws. */
export function statsFromRows(rows: UsageDoc[]): UserStats {
  const days = new Map<string, DayPoint>();
  const models = new Map<string, ModelPoint>();
  const tools = new Map<
    string,
    { tool: string; cost: number; tokens: number; requests: number }
  >();

  for (const row of rows) {
    const day = days.get(row.day) ?? {
      day: row.day,
      cost: 0,
      tokens: 0,
      requests: 0,
      input: 0,
      output: 0,
      cacheWrite: 0,
      cacheRead: 0,
    };
    day.cost += row.costUsd;
    day.tokens += tokensOf(row);
    day.requests += row.requests;
    day.input += row.input;
    day.output += row.output;
    day.cacheWrite += row.cacheWrite5m + row.cacheWrite1h;
    day.cacheRead += row.cacheRead;
    days.set(row.day, day);

    const model =
      models.get(row.model) ??
      ({
        model: row.model,
        cost: 0,
        tokens: 0,
        requests: 0,
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
      } satisfies ModelPoint);
    model.cost += row.costUsd;
    model.tokens += tokensOf(row);
    model.requests += row.requests;
    model.input += row.input;
    model.output += row.output;
    model.cacheRead += row.cacheRead;
    model.cacheWrite += row.cacheWrite5m + row.cacheWrite1h;
    models.set(row.model, model);

    const tool = tools.get(row.tool) ?? {
      tool: row.tool,
      cost: 0,
      tokens: 0,
      requests: 0,
    };
    tool.cost += row.costUsd;
    tool.tokens += tokensOf(row);
    tool.requests += row.requests;
    tools.set(row.tool, tool);
  }

  const byDay = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  const byModel = [...models.values()].sort((a, b) => b.cost - a.cost);
  const byTool = [...tools.values()].sort((a, b) => b.cost - a.cost);

  const totals = byDay.reduce(
    (acc, point) => ({
      cost: acc.cost + point.cost,
      tokens: acc.tokens + point.tokens,
      requests: acc.requests + point.requests,
      days: acc.days + 1,
    }),
    { cost: 0, tokens: 0, requests: 0, days: 0 },
  );

  const tokens = byModel.reduce(
    (acc, point) => ({
      input: acc.input + point.input,
      output: acc.output + point.output,
      cacheWrite: acc.cacheWrite + point.cacheWrite,
      cacheRead: acc.cacheRead + point.cacheRead,
    }),
    { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 },
  );

  const streaks = computeStreaks(byDay.map((point) => point.day));
  const best = byDay.reduce<DayPoint | null>(
    (top, point) => (top === null || point.cost > top.cost ? point : top),
    null,
  );

  return {
    totals,
    tokens,
    byDay,
    byModel,
    byTool,
    firstDay: byDay[0]?.day ?? null,
    lastDay: byDay[byDay.length - 1]?.day ?? null,
    streak: streaks.current,
    longestStreak: streaks.longest,
    best,
  };
}

/**
 * One user's agent runs: how many, how long in all, and the longest single
 * run. Read directly, like `userStats`, so a sync shows at once.
 */
export async function agentStats(
  userId: string,
  options: { tool?: string } = {},
): Promise<AgentSummary> {
  const rows = fixturesOn()
    ? fixtureAgents(userId).filter((row) => !options.tool || row.tool === options.tool)
    : await listAgents(userId, options);
  return summarizeAgents(rows);
}

/**
 * A streak is consecutive days with any usage. The current streak only counts
 * if it reaches today or yesterday — the day is not over everywhere at once, so
 * ending "yesterday" must not break it.
 */
export function computeStreaks(days: string[]): { current: number; longest: number } {
  if (days.length === 0) return { current: 0, longest: 0 };

  let longest = 1;
  let run = 1;

  for (let index = 1; index < days.length; index++) {
    if (days[index] === shiftDay(days[index - 1]!, 1)) {
      run++;
    } else {
      run = 1;
    }
    longest = Math.max(longest, run);
  }

  const last = days[days.length - 1]!;
  const now = today();
  const live = last === now || last === shiftDay(now, -1);

  return { current: live ? run : 0, longest };
}

/* ------------------------------------------------------------ eaon board */

/**
 * The Eaon Desktop board: everyone who has used the app, ranked by the tokens
 * it reported.
 *
 * Built from the same hourly snapshot as the main board — the Eaon cells are
 * collected while the snapshot is folded, and agent runs are read alongside
 * the usage — so a page view costs no database reads. Privacy follows the
 * main board exactly: private and opted-out accounts are never ranked, and
 * still count, anonymously, toward the totals above the table.
 */

export type EaonPeriod = "7d" | "30d" | "all";

export const EAON_PERIODS: { key: EaonPeriod; label: string }[] = [
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "all", label: "all time" },
];

export function isEaonPeriod(value: string | undefined): value is EaonPeriod {
  return value === "7d" || value === "30d" || value === "all";
}

function eaonStart(period: EaonPeriod): string | null {
  if (period === "7d") return shiftDay(today(), -6);
  if (period === "30d") return shiftDay(today(), -29);
  return null;
}

/** Days in each row's sparkline. Two weeks shows a habit without the noise. */
export const EAON_SPARK_DAYS = 14;

export interface EaonEntry {
  rank: number;
  userId: string;
  handle: string;
  name: string | null;
  avatarUrl: string | null;
  prefs: string | null;
  joined: string;
  /** Within the period. */
  tokens: number;
  cost: number;
  runs: number;
  agentMs: number;
  /** All-time, like a profile's. */
  streak: number;
  lastDay: string | null;
  /** Tokens per day for the last `EAON_SPARK_DAYS` days, oldest first. */
  series: number[];
}

export async function eaonBoard(period: EaonPeriod, limit = 100): Promise<EaonEntry[]> {
  const [{ eaonRows, agents }, profiles] = await Promise.all([snapshot(), cachedProfiles()]);
  const start = eaonStart(period);
  const sparkStart = shiftDay(today(), -(EAON_SPARK_DAYS - 1));
  const sparkIndex = new Map(
    Array.from({ length: EAON_SPARK_DAYS }, (_, index) => [shiftDay(sparkStart, index), index]),
  );

  interface Acc {
    tokens: number;
    cost: number;
    runs: number;
    agentMs: number;
    days: Set<string>;
    lastDay: string | null;
    series: number[];
  }
  const byUser = new Map<string, Acc>();
  const accFor = (userId: string): Acc => {
    let acc = byUser.get(userId);
    if (!acc) {
      acc = {
        tokens: 0,
        cost: 0,
        runs: 0,
        agentMs: 0,
        days: new Set(),
        lastDay: null,
        series: new Array<number>(EAON_SPARK_DAYS).fill(0),
      };
      byUser.set(userId, acc);
    }
    return acc;
  };

  for (const row of eaonRows) {
    if (row.tokens <= 0 && row.requests <= 0) continue;
    const acc = accFor(row.userId);
    acc.days.add(row.day);
    if (!acc.lastDay || row.day > acc.lastDay) acc.lastDay = row.day;
    if (inWindow(row, start)) {
      acc.tokens += row.tokens;
      acc.cost += row.cost;
    }
    const position = sparkIndex.get(row.day);
    if (position !== undefined) acc.series[position] = (acc.series[position] ?? 0) + row.tokens;
  }

  for (const row of agents) {
    if (row.runs <= 0) continue;
    const acc = accFor(row.userId);
    acc.days.add(row.day);
    if (!acc.lastDay || row.day > acc.lastDay) acc.lastDay = row.day;
    if (inWindow(row, start)) {
      acc.runs += row.runs;
      acc.agentMs += row.totalMs;
    }
  }

  const entries: EaonEntry[] = [];
  for (const profile of profiles) {
    // Same rule as the main board: private or opted out is never ranked.
    if (!listedFor(profile)) continue;
    const acc = byUser.get(profile.$id);
    if (!acc) continue;

    entries.push({
      rank: 0,
      userId: profile.$id,
      handle: profile.handle,
      name: profile.name ?? null,
      avatarUrl: profile.avatarUrl ?? null,
      prefs: profile.prefs ?? null,
      joined: profile.createdAt,
      tokens: acc.tokens,
      cost: acc.cost,
      runs: acc.runs,
      agentMs: acc.agentMs,
      streak: computeStreaks([...acc.days].sort()).current,
      lastDay: acc.lastDay,
      series: acc.series,
    });
  }

  return entries
    .sort(
      (a, b) =>
        b.tokens - a.tokens ||
        b.runs - a.runs ||
        a.joined.localeCompare(b.joined) ||
        a.handle.localeCompare(b.handle),
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }))
    .slice(0, limit);
}

export interface EaonTotals {
  /** Everyone with Eaon activity in the period, ranked or not. */
  users: number;
  tokens: number;
  cost: number;
  runs: number;
  agentMs: number;
  /** Tokens per day across everyone, dense over the period. */
  series: SeriesPoint[];
}

interface SeriesPoint {
  day: string;
  value: number;
}

export async function eaonTotals(period: EaonPeriod): Promise<EaonTotals> {
  const { eaonRows, agents } = await snapshot();
  const start = eaonStart(period);
  const users = new Set<string>();
  const byDay = new Map<string, number>();
  let tokens = 0;
  let cost = 0;
  let runs = 0;
  let agentMs = 0;
  let first: string | null = null;

  for (const row of eaonRows) {
    if (!inWindow(row, start)) continue;
    users.add(row.userId);
    tokens += row.tokens;
    cost += row.cost;
    byDay.set(row.day, (byDay.get(row.day) ?? 0) + row.tokens);
    if (!first || row.day < first) first = row.day;
  }
  for (const row of agents) {
    if (row.runs <= 0 || !inWindow(row, start)) continue;
    users.add(row.userId);
    runs += row.runs;
    agentMs += row.totalMs;
  }

  // Dense, so a quiet day draws as a dip rather than as a straight line
  // across it.
  const now = today();
  const from = start ?? first ?? now;
  const series: SeriesPoint[] = [];
  for (let day = from; day <= now; day = shiftDay(day, 1)) {
    series.push({ day, value: byDay.get(day) ?? 0 });
  }

  return { users: users.size, tokens, cost, runs, agentMs, series };
}

/** Where someone stands on the Eaon board, or null if they are not on it. */
export async function eaonRankOf(
  userId: string,
  period: EaonPeriod = "all",
): Promise<number | null> {
  const board = await eaonBoard(period, 100_000);
  const entry = board.find((row) => row.userId === userId);
  return entry && entry.tokens > 0 ? entry.rank : null;
}

/* --------------------------------------------------------------- devices */

export interface SyncInfo {
  lastSyncAt: string | null;
  devices: number;
}

export async function syncInfo(userId: string): Promise<SyncInfo> {
  const devices = await listDevices(userId);
  const lastSyncAt = devices.reduce<string | null>(
    (latest, device) =>
      device.lastSyncAt && (!latest || device.lastSyncAt > latest)
        ? device.lastSyncAt
        : latest,
    null,
  );

  return { lastSyncAt, devices: devices.length };
}
