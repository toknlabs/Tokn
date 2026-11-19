import "server-only";
import { listedFor } from "./backend";
import {
  EAON_TOOL,
  agentStats,
  computeStreaks,
  eaonSnapshot,
  shiftDay,
  today,
  userStats,
  type EaonBoardRow,
  type UserStats,
} from "./stats";

/**
 * Everything tokns.eaon.dev shows: the Eaon Desktop index (the board, the
 * totals, the records, the shape of everyone's usage) and one person's
 * numbers. All of it is worked out from the same hourly snapshot the boards
 * use, so a page view costs no reads; a profile also reads its owner's rows
 * directly, like a tokn profile does, so a sync shows at once.
 *
 * Privacy is the board's: only listed, public accounts are ever named. The
 * rest still count, anonymously, in every total, distribution and percentile.
 */

export type IndexPeriod = "7d" | "30d" | "90d" | "all";

export const INDEX_PERIODS: { key: IndexPeriod; label: string; days: number | null }[] = [
  { key: "7d", label: "7d", days: 7 },
  { key: "30d", label: "30d", days: 30 },
  { key: "90d", label: "90d", days: 90 },
  { key: "all", label: "All", days: null },
];

export const isIndexPeriod = (value: string | undefined): value is IndexPeriod =>
  INDEX_PERIODS.some((period) => period.key === value);

export type IndexSort = "tokens" | "agents" | "time" | "streak" | "cache";

export const INDEX_SORTS: { key: IndexSort; label: string }[] = [
  { key: "tokens", label: "Tokens" },
  { key: "agents", label: "Agents" },
  { key: "time", label: "Agent time" },
  { key: "streak", label: "Streak" },
  { key: "cache", label: "Cache hit" },
];

export const isIndexSort = (value: string | undefined): value is IndexSort =>
  INDEX_SORTS.some((sort) => sort.key === value);

/** Days in each board row's sparkline. */
export const SPARK_DAYS = 21;

export interface Kinds {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

const noKinds = (): Kinds => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

/**
 * Of every prompt token, the share served from cache. Output is left out: it
 * can't be cached, so counting it would make chatty work look worse at
 * caching than it is.
 */
export function cacheHit(kinds: Kinds): number {
  const prompt = kinds.input + kinds.cacheRead + kinds.cacheWrite;
  return prompt > 0 ? kinds.cacheRead / prompt : 0;
}

/** Who made a model, from its name: what the "by maker" split is drawn from. */
export function makerOf(model: string): string {
  const name = model.toLowerCase();
  if (name.includes("claude") || name.startsWith("anthropic")) return "Anthropic";
  if (/^(gpt|o\d|chatgpt|codex|openai)/.test(name) || name.includes("gpt")) return "OpenAI";
  if (name.includes("gemini") || name.includes("gemma")) return "Google";
  if (name.includes("grok")) return "xAI";
  if (name.includes("deepseek")) return "DeepSeek";
  if (name.includes("qwen")) return "Qwen";
  if (name.includes("llama")) return "Meta";
  if (name.includes("mistral") || name.includes("codestral") || name.includes("devstral")) return "Mistral";
  return "Other";
}

/** Shannon entropy of a share list, in bits: 0 for one model, log2(n) for n used evenly. */
export function entropyBits(values: number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return 0;
  let bits = 0;
  for (const value of values) {
    if (value <= 0) continue;
    const p = value / total;
    bits -= p * Math.log2(p);
  }
  return bits;
}

/** The Gini coefficient of a set of totals: 0 when everyone uses the same, towards 1 when one person uses it all. */
export function gini(values: number[]): number {
  const sorted = values.filter((value) => value > 0).sort((a, b) => a - b);
  const n = sorted.length;
  if (n < 2) return 0;
  let weighted = 0;
  let total = 0;
  sorted.forEach((value, index) => {
    weighted += (index + 1) * value;
    total += value;
  });
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

/** The value at quantile `q` (0..1) of a list, by nearest rank. */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
  return sorted[index] ?? 0;
}

/** The share of `values` strictly below `value`: 0.97 is "more than 97% of people". */
export function percentileOf(values: number[], value: number): number {
  if (values.length === 0) return 0;
  return values.filter((other) => other < value).length / values.length;
}

const WEEKDAY = (day: string): number => (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7; // Monday first

function startOf(period: IndexPeriod, now = today()): string | null {
  const days = INDEX_PERIODS.find((entry) => entry.key === period)?.days ?? null;
  return days === null ? null : shiftDay(now, -(days - 1));
}

/* ------------------------------------------------------------- the index */

interface Named {
  userId: string;
  handle: string | null;
  name: string | null;
}

export interface IndexEntry {
  rank: number;
  userId: string;
  handle: string;
  name: string | null;
  avatarUrl: string | null;
  prefs: string | null;
  tokens: number;
  cost: number;
  requests: number;
  kinds: Kinds;
  cacheHit: number;
  runs: number;
  agentMs: number;
  longestMs: number;
  activeDays: number;
  streak: number;
  longestStreak: number;
  topModel: string | null;
  models: number;
  /** Tokens per day over the last `SPARK_DAYS` days, oldest first. */
  series: number[];
}

export interface IndexDay extends Kinds {
  day: string;
  tokens: number;
  runs: number;
  agentMs: number;
  users: number;
}

export interface IndexRecord {
  label: string;
  value: string;
  who: Named;
  day?: string;
}

export interface EaonIndex {
  updatedAt: string;
  period: IndexPeriod;
  totals: {
    users: number;
    activeToday: number;
    tokens: number;
    cost: number;
    requests: number;
    kinds: Kinds;
    runs: number;
    agentMs: number;
    longestMs: number;
    models: number;
  };
  /** The same figures for the period before, for the deltas; null for all time. */
  previous: { users: number; tokens: number; runs: number; agentMs: number } | null;
  days: IndexDay[];
  models: { model: string; tokens: number; users: number }[];
  makers: { maker: string; tokens: number }[];
  weekdays: { tokens: number; runs: number }[];
  distribution: {
    buckets: { label: string; users: number }[];
    p50: number;
    p90: number;
    p99: number;
    gini: number;
    /** The share of all tokens the top 10% of people account for. */
    top10Share: number;
  };
  records: IndexRecord[];
  entries: IndexEntry[];
}

const BUCKETS: { label: string; below: number }[] = [
  { label: "<100K", below: 1e5 },
  { label: "100K", below: 1e6 },
  { label: "1M", below: 1e7 },
  { label: "10M", below: 1e8 },
  { label: "100M", below: 1e9 },
  { label: "1B+", below: Infinity },
];

interface PersonAcc {
  tokens: number;
  cost: number;
  requests: number;
  kinds: Kinds;
  runs: number;
  agentMs: number;
  longestMs: number;
  periodDays: Set<string>;
  allDays: Set<string>;
  byModel: Map<string, number>;
  series: number[];
}

export async function eaonIndex(period: IndexPeriod, sort: IndexSort = "tokens"): Promise<EaonIndex> {
  const { updatedAt, rows, agents, profiles } = await eaonSnapshot();
  const now = today();
  const start = startOf(period, now);
  const length = INDEX_PERIODS.find((entry) => entry.key === period)?.days ?? null;
  const previousStart = start && length ? shiftDay(start, -length) : null;
  const inPeriod = (day: string) => (!start || day >= start) && day <= now;
  const inPrevious = (day: string) => Boolean(previousStart && start && day >= previousStart && day < start);
  const sparkStart = shiftDay(now, -(SPARK_DAYS - 1));

  const people = new Map<string, PersonAcc>();
  const person = (userId: string): PersonAcc => {
    let acc = people.get(userId);
    if (!acc) {
      acc = {
        tokens: 0,
        cost: 0,
        requests: 0,
        kinds: noKinds(),
        runs: 0,
        agentMs: 0,
        longestMs: 0,
        periodDays: new Set(),
        allDays: new Set(),
        byModel: new Map(),
        series: new Array<number>(SPARK_DAYS).fill(0),
      };
      people.set(userId, acc);
    }
    return acc;
  };

  const days = new Map<string, IndexDay & { who: Set<string> }>();
  const dayFor = (day: string) => {
    let point = days.get(day);
    if (!point) {
      point = { day, tokens: 0, runs: 0, agentMs: 0, users: 0, ...noKinds(), who: new Set() };
      days.set(day, point);
    }
    return point;
  };

  const totals = { tokens: 0, cost: 0, requests: 0, kinds: noKinds(), runs: 0, agentMs: 0, longestMs: 0 };
  const previous = { users: new Set<string>(), tokens: 0, runs: 0, agentMs: 0 };
  const models = new Map<string, { tokens: number; users: Set<string> }>();
  const weekdays = Array.from({ length: 7 }, () => ({ tokens: 0, runs: 0 }));
  const activeToday = new Set<string>();

  // All-time records, whatever the period: the best day, run and the rest.
  let bestDay: { userId: string; day: string; tokens: number } | null = null;
  const dayTokens = new Map<string, number>(); // userId|day → tokens, for the best day

  const addKinds = (into: Kinds, row: EaonBoardRow) => {
    into.input += row.input;
    into.output += row.output;
    into.cacheRead += row.cacheRead;
    into.cacheWrite += row.cacheWrite;
  };

  for (const row of rows) {
    if (row.tokens <= 0 && row.requests <= 0) continue;
    const acc = person(row.userId);
    acc.allDays.add(row.day);
    const key = `${row.userId}|${row.day}`;
    dayTokens.set(key, (dayTokens.get(key) ?? 0) + row.tokens);
    if (row.day >= sparkStart && row.day <= now) {
      const index = Math.round((Date.parse(`${row.day}T00:00:00Z`) - Date.parse(`${sparkStart}T00:00:00Z`)) / 86_400_000);
      if (index >= 0 && index < SPARK_DAYS) acc.series[index] = (acc.series[index] ?? 0) + row.tokens;
    }
    if (row.day === now) activeToday.add(row.userId);
    if (inPrevious(row.day)) {
      previous.users.add(row.userId);
      previous.tokens += row.tokens;
    }
    if (!inPeriod(row.day)) continue;

    acc.tokens += row.tokens;
    acc.cost += row.cost;
    acc.requests += row.requests;
    addKinds(acc.kinds, row);
    acc.periodDays.add(row.day);
    acc.byModel.set(row.model, (acc.byModel.get(row.model) ?? 0) + row.tokens);

    totals.tokens += row.tokens;
    totals.cost += row.cost;
    totals.requests += row.requests;
    addKinds(totals.kinds, row);

    const point = dayFor(row.day);
    point.tokens += row.tokens;
    addKinds(point, row);
    point.who.add(row.userId);

    const model = models.get(row.model) ?? { tokens: 0, users: new Set<string>() };
    model.tokens += row.tokens;
    model.users.add(row.userId);
    models.set(row.model, model);

    const weekday = weekdays[WEEKDAY(row.day)];
    if (weekday) weekday.tokens += row.tokens;
  }

  for (const [key, tokens] of dayTokens) {
    if (!bestDay || tokens > bestDay.tokens) {
      const [userId, day] = key.split("|") as [string, string];
      bestDay = { userId, day, tokens };
    }
  }

  let longestRun: { userId: string; day: string; ms: number } | null = null;
  let busiestRuns: { userId: string; day: string; runs: number } | null = null;
  for (const row of agents) {
    if (row.runs <= 0) continue;
    const acc = person(row.userId);
    acc.allDays.add(row.day);
    if (!longestRun || row.longestMs > longestRun.ms) longestRun = { userId: row.userId, day: row.day, ms: row.longestMs };
    if (!busiestRuns || row.runs > busiestRuns.runs) busiestRuns = { userId: row.userId, day: row.day, runs: row.runs };
    if (row.day === now) activeToday.add(row.userId);
    if (inPrevious(row.day)) {
      previous.users.add(row.userId);
      previous.runs += row.runs;
      previous.agentMs += row.totalMs;
    }
    if (!inPeriod(row.day)) continue;
    acc.runs += row.runs;
    acc.agentMs += row.totalMs;
    acc.longestMs = Math.max(acc.longestMs, row.longestMs);
    acc.periodDays.add(row.day);
    totals.runs += row.runs;
    totals.agentMs += row.totalMs;
    totals.longestMs = Math.max(totals.longestMs, row.longestMs);
    const point = dayFor(row.day);
    point.runs += row.runs;
    point.agentMs += row.totalMs;
    point.who.add(row.userId);
    const weekday = weekdays[WEEKDAY(row.day)];
    if (weekday) weekday.runs += row.runs;
  }

  // Dense days, so a quiet one draws as a dip rather than a straight line across it.
  const first = [...days.keys()].sort()[0] ?? now;
  const from = start ?? first;
  const dense: IndexDay[] = [];
  for (let day = from; day <= now; day = shiftDay(day, 1)) {
    const point = days.get(day);
    dense.push(
      point
        ? { day, tokens: point.tokens, runs: point.runs, agentMs: point.agentMs, users: point.who.size, input: point.input, output: point.output, cacheRead: point.cacheRead, cacheWrite: point.cacheWrite }
        : { day, tokens: 0, runs: 0, agentMs: 0, users: 0, ...noKinds() },
    );
  }

  const byId = new Map(profiles.map((profile) => [profile.$id, profile]));
  const named = (userId: string): Named => {
    const profile = byId.get(userId);
    return profile && listedFor(profile)
      ? { userId, handle: profile.handle, name: profile.name ?? null }
      : { userId, handle: null, name: null };
  };

  const active = [...people.entries()].filter(([, acc]) => acc.tokens > 0 || acc.runs > 0);
  const tokensPerPerson = active.map(([, acc]) => acc.tokens).filter((tokens) => tokens > 0);
  const totalTokens = tokensPerPerson.reduce((sum, tokens) => sum + tokens, 0);
  const sortedDesc = [...tokensPerPerson].sort((a, b) => b - a);
  const topCount = Math.max(1, Math.ceil(sortedDesc.length * 0.1));
  const topTokens = sortedDesc.slice(0, topCount).reduce((sum, tokens) => sum + tokens, 0);

  const streaks = new Map<string, { current: number; longest: number }>();
  for (const [userId, acc] of people) streaks.set(userId, computeStreaks([...acc.allDays].sort()));
  let longestStreak: { userId: string; days: number } | null = null;
  let mostModels: { userId: string; models: number } | null = null;
  for (const [userId, acc] of people) {
    const streak = streaks.get(userId)?.longest ?? 0;
    if (!longestStreak || streak > longestStreak.days) longestStreak = { userId, days: streak };
    if (!mostModels || acc.byModel.size > mostModels.models) mostModels = { userId, models: acc.byModel.size };
  }

  const records: IndexRecord[] = [];
  if (bestDay) records.push({ label: "biggest day", value: `${bestDay.tokens}`, who: named(bestDay.userId), day: bestDay.day });
  if (longestRun) records.push({ label: "longest agent run", value: `${longestRun.ms}`, who: named(longestRun.userId), day: longestRun.day });
  if (busiestRuns) records.push({ label: "most agents in a day", value: `${busiestRuns.runs}`, who: named(busiestRuns.userId), day: busiestRuns.day });
  if (longestStreak && longestStreak.days > 0) records.push({ label: "longest streak", value: `${longestStreak.days}`, who: named(longestStreak.userId) });
  if (mostModels && mostModels.models > 0) records.push({ label: "most models", value: `${mostModels.models}`, who: named(mostModels.userId) });

  const entries: IndexEntry[] = [];
  for (const [userId, acc] of active) {
    const profile = byId.get(userId);
    if (!profile || !listedFor(profile)) continue;
    const top = [...acc.byModel.entries()].sort((a, b) => b[1] - a[1])[0];
    const streak = streaks.get(userId) ?? { current: 0, longest: 0 };
    entries.push({
      rank: 0,
      userId,
      handle: profile.handle,
      name: profile.name ?? null,
      avatarUrl: profile.avatarUrl ?? null,
      prefs: profile.prefs ?? null,
      tokens: acc.tokens,
      cost: acc.cost,
      requests: acc.requests,
      kinds: acc.kinds,
      cacheHit: cacheHit(acc.kinds),
      runs: acc.runs,
      agentMs: acc.agentMs,
      longestMs: acc.longestMs,
      activeDays: acc.periodDays.size,
      streak: streak.current,
      longestStreak: streak.longest,
      topModel: top?.[0] ?? null,
      models: acc.byModel.size,
      series: acc.series,
    });
  }
  const by: Record<IndexSort, (entry: IndexEntry) => number> = {
    tokens: (entry) => entry.tokens,
    agents: (entry) => entry.runs,
    time: (entry) => entry.agentMs,
    streak: (entry) => entry.streak,
    cache: (entry) => (entry.tokens >= 100_000 ? entry.cacheHit : -1),
  };
  entries.sort((a, b) => by[sort](b) - by[sort](a) || b.tokens - a.tokens || a.handle.localeCompare(b.handle));
  entries.forEach((entry, index) => (entry.rank = index + 1));

  const makerTotals = new Map<string, number>();
  for (const [model, value] of models) makerTotals.set(makerOf(model), (makerTotals.get(makerOf(model)) ?? 0) + value.tokens);

  return {
    updatedAt,
    period,
    totals: {
      users: active.length,
      activeToday: activeToday.size,
      tokens: totals.tokens,
      cost: totals.cost,
      requests: totals.requests,
      kinds: totals.kinds,
      runs: totals.runs,
      agentMs: totals.agentMs,
      longestMs: totals.longestMs,
      models: models.size,
    },
    previous: start ? { users: previous.users.size, tokens: previous.tokens, runs: previous.runs, agentMs: previous.agentMs } : null,
    days: dense,
    models: [...models.entries()]
      .map(([model, value]) => ({ model, tokens: value.tokens, users: value.users.size }))
      .sort((a, b) => b.tokens - a.tokens),
    makers: [...makerTotals.entries()].map(([maker, tokens]) => ({ maker, tokens })).sort((a, b) => b.tokens - a.tokens),
    weekdays,
    distribution: {
      buckets: BUCKETS.map((bucket, index) => ({
        label: bucket.label,
        users: tokensPerPerson.filter((tokens) => tokens < bucket.below && tokens >= (BUCKETS[index - 1]?.below ?? 0)).length,
      })),
      p50: quantile(tokensPerPerson, 0.5),
      p90: quantile(tokensPerPerson, 0.9),
      p99: quantile(tokensPerPerson, 0.99),
      gini: gini(tokensPerPerson),
      top10Share: totalTokens > 0 ? topTokens / totalTokens : 0,
    },
    records,
    entries,
  };
}

/* -------------------------------------------------------------- a person */

export interface EaonPerson {
  stats: UserStats;
  agents: Awaited<ReturnType<typeof agentStats>>;
  kinds: Kinds;
  cacheHit: number;
  outputShare: number;
  tokensPerRequest: number;
  costPerMillion: number;
  modelBits: number;
  weekdays: { tokens: number; runs: number }[];
  weekendShare: number;
  /** Tokens in the last 7 days against the 7 before: +0.25 is up a quarter. Null with nothing to compare. */
  momentum: number | null;
  maxRunsDay: { day: string; runs: number } | null;
  /** Where they stand among everyone who uses Eaon Desktop, all time: 0.97 is ahead of 97%. */
  percentiles: { tokens: number; runs: number; agentMs: number; streak: number } | null;
  rank: number | null;
  ranked: number;
}

export async function eaonPerson(userId: string): Promise<EaonPerson> {
  const [stats, agents, index] = await Promise.all([
    userStats(userId, "all", { tool: EAON_TOOL }),
    agentStats(userId, { tool: EAON_TOOL }),
    eaonIndex("all"),
  ]);

  const kinds: Kinds = {
    input: stats.tokens.input,
    output: stats.tokens.output,
    cacheRead: stats.tokens.cacheRead,
    cacheWrite: stats.tokens.cacheWrite,
  };
  const weekdays = Array.from({ length: 7 }, () => ({ tokens: 0, runs: 0 }));
  for (const point of stats.byDay) {
    const weekday = weekdays[WEEKDAY(point.day)];
    if (weekday) weekday.tokens += point.tokens;
  }
  let maxRunsDay: EaonPerson["maxRunsDay"] = null;
  for (const point of agents.byDay) {
    const weekday = weekdays[WEEKDAY(point.day)];
    if (weekday) weekday.runs += point.runs;
    if (!maxRunsDay || point.runs > maxRunsDay.runs) maxRunsDay = { day: point.day, runs: point.runs };
  }
  const weekTokens = weekdays.reduce((sum, day) => sum + day.tokens, 0);
  const weekendTokens = (weekdays[5]?.tokens ?? 0) + (weekdays[6]?.tokens ?? 0);

  const now = today();
  const sum = (from: string, to: string) =>
    stats.byDay.filter((point) => point.day >= from && point.day <= to).reduce((total, point) => total + point.tokens, 0);
  const last7 = sum(shiftDay(now, -6), now);
  const before7 = sum(shiftDay(now, -13), shiftDay(now, -7));

  // Percentiles against the people on the all-time board. Someone who isn't
  // listed still sees where they would stand; nobody else is named either way.
  const board = index.entries;
  const mine = board.find((entry) => entry.userId === userId) ?? null;
  // Everyone else: being ahead of yourself isn't a thing.
  const others = board.filter((entry) => entry.userId !== userId);
  const percentiles =
    others.length > 0
      ? {
          tokens: percentileOf(others.map((entry) => entry.tokens), stats.totals.tokens),
          runs: percentileOf(others.map((entry) => entry.runs), agents.runs),
          agentMs: percentileOf(others.map((entry) => entry.agentMs), agents.totalMs),
          streak: percentileOf(others.map((entry) => entry.streak), stats.streak),
        }
      : null;

  return {
    stats,
    agents,
    kinds,
    cacheHit: cacheHit(kinds),
    outputShare: stats.totals.tokens > 0 ? kinds.output / stats.totals.tokens : 0,
    tokensPerRequest: stats.totals.requests > 0 ? stats.totals.tokens / stats.totals.requests : 0,
    costPerMillion: stats.totals.tokens > 0 ? (stats.totals.cost / stats.totals.tokens) * 1e6 : 0,
    modelBits: entropyBits(stats.byModel.map((model) => model.tokens)),
    weekdays,
    weekendShare: weekTokens > 0 ? weekendTokens / weekTokens : 0,
    momentum: before7 > 0 ? (last7 - before7) / before7 : null,
    maxRunsDay,
    percentiles,
    rank: mine?.rank ?? null,
    ranked: board.length,
  };
}
