import "server-only";
import { unstable_cache } from "next/cache";
import {
  canonicalModelId,
  listAllProfiles,
  listAllUsage,
  listedFor,
  type Profile,
  type UsageDoc,
} from "./backend";
import { shiftDay, today, type DayPoint } from "./stats";

/**
 * Everything the /stats page shows, from a single pass over the raw rows.
 *
 * Appwrite has no GROUP BY, so the aggregation happens here in memory. The
 * rolling window is the headline and all-time sits beside it for scale; both
 * come out of the same pass, so the page costs one fetch rather than one per
 * section.
 *
 * Same caveat as the leaderboard: this loads every usage row, which is fine at
 * current scale and deliberately not a long-term plan.
 */

export interface ToolPoint {
  tool: string;
  cost: number;
  tokens: number;
  requests: number;
  users: number;
}

export interface ModelSlice {
  model: string;
  cost: number;
  tokens: number;
  requests: number;
  /** How many people used it, which is a different story from what it cost. */
  users: number;
}

export interface Highlight {
  handle: string;
  value: number;
  detail?: string;
}

export interface SiteStats {
  windowDays: number;
  users: {
    total: number;
    reporting: number;
    joinedThisWeek: number;
    activeInWindow: number;
  };
  window: {
    cost: number;
    tokens: number;
    requests: number;
    daysWithUsage: number;
  };
  allTime: {
    cost: number;
    tokens: number;
    requests: number;
    firstDay: string | null;
    /** Distinct models and days ever recorded, as opposed to the window's. */
    models: number;
    days: number;
  };
  byDay: DayPoint[];
  byModel: ModelSlice[];
  byTool: ToolPoint[];
  records: {
    biggestDay: Highlight | null;
    mostRequests: Highlight | null;
    mostModels: Highlight | null;
  };
  recentSyncs: { handle: string; at: string }[];
}

const tokensOf = (row: UsageDoc): number =>
  row.input + row.output + row.cacheWrite5m + row.cacheWrite1h + row.cacheRead;

interface Bucket {
  cost: number;
  tokens: number;
  requests: number;
  /** Only filled for day buckets, which feed the per-day token chart. */
  input?: number;
  output?: number;
  cacheWrite?: number;
  cacheRead?: number;
}

interface UserAcc extends Bucket {
  models: Set<string>;
  lastSync: string;
}

/**
 * The site-wide figures, cached across requests.
 *
 * This is the most expensive read in the app: it scans every row of
 * `usage_daily` to build series by day, model and tool, none of which the
 * `user_totals` rollup carries. At one billed read per (day, tool, model)
 * bucket, running it per visitor is what exhausted a 1.75M monthly read quota.
 *
 * The cache lives on the data rather than the page because page-level
 * `revalidate` cannot work here: the root layout calls `currentUser()`, which
 * reads cookies, so every route under it is dynamic and no page is ever
 * prerendered. `unstable_cache` is unaffected by that — it memoises the result
 * itself, so one scan serves every visitor for the whole window.
 *
 * Nothing here is per-user, so there is no key beyond the window length.
 */
/**
 * An hour.
 *
 * Six hours, arrived at by arithmetic rather than taste. Each miss is a full
 * scan of `usage_daily`, and a month holds 2.59M seconds, so the monthly cost
 * is (2,592,000 / ttl) x rows. At 3,000 rows: five minutes is 26M reads, an
 * hour is 2.2M, and six hours is 360k. Only the last one fits inside the
 * plan's budget, and nothing on a site-wide chart moves perceptibly in six
 * hours anyway.
 *
 * This number is a read budget, not a freshness preference. Raising it is
 * cheap; lowering it multiplies the most expensive query in the app.
 */
const SITE_STATS_TTL_SECONDS = 21_600;

export const siteStats = unstable_cache(computeSiteStats, ["site-stats"], {
  revalidate: SITE_STATS_TTL_SECONDS,
});

/**
 * Rows past which a scan is no longer an acceptable way to build this page.
 *
 * Appwrite bills a read per document, so this scan's cost is exactly its row
 * count. The first time it went wrong there was nothing to see: the query kept
 * working and simply got more expensive every week until the quota died mid
 * month. A line in the log is not a fix, but it turns a silent drain into
 * something that shows up before the bill does.
 */
const SCAN_ROW_WARNING = 25_000;

async function computeSiteStats(windowDays = 30): Promise<SiteStats> {
  const [usage, profiles] = await Promise.all([
    listAllUsage(),
    listAllProfiles(),
  ]);

  if (usage.length > SCAN_ROW_WARNING) {
    console.warn(
      `[site-stats] scanned ${usage.length} usage rows — that is ${usage.length} billed reads ` +
        `per cache miss. Past this size the page needs a per-day rollup rather than a scan.`,
    );
  }

  const start = shiftDay(today(), -(windowDays - 1));
  const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const handleOf = handleLookup(profiles);

  const days = new Map<string, Bucket>();
  const models = new Map<string, Bucket & { users: Set<string> }>();
  const tools = new Map<string, Bucket & { users: Set<string> }>();
  const perUser = new Map<string, UserAcc>();
  // A "biggest day" is a user-day pair, not a day and not a user.
  const userDays = new Map<string, number>();

  const window = { cost: 0, tokens: 0, requests: 0 };
  const allTime = { cost: 0, tokens: 0, requests: 0 };
  // `byModel` and `byDay` below are windowed, so the all-time equivalents have
  // to be counted separately or the about page ends up captioning a 30-day
  // figure as a lifetime one.
  const allModels = new Set<string>();
  const allDays = new Set<string>();
  let firstDay: string | null = null;

  for (const row of usage) {
    const tokens = tokensOf(row);
    const modelId = canonicalModelId(row.model);

    allTime.cost += row.costUsd;
    allTime.tokens += tokens;
    allTime.requests += row.requests;
    if (!firstDay || row.day < firstDay) firstDay = row.day;
    allModels.add(modelId);
    allDays.add(row.day);

    if (row.day < start) continue;

    window.cost += row.costUsd;
    window.tokens += tokens;
    window.requests += row.requests;

    add(days, row.day, row.costUsd, tokens, row.requests);

    const model = models.get(modelId) ?? {
      cost: 0,
      tokens: 0,
      requests: 0,
      users: new Set<string>(),
    };
    model.cost += row.costUsd;
    model.tokens += tokens;
    model.requests += row.requests;
    model.users.add(row.userId);
    models.set(modelId, model);

    const tool = tools.get(row.tool) ?? {
      cost: 0,
      tokens: 0,
      requests: 0,
      users: new Set(),
    };
    tool.cost += row.costUsd;
    tool.tokens += tokens;
    tool.requests += row.requests;
    tool.users.add(row.userId);
    tools.set(row.tool, tool);

    const key = `${row.userId} ${row.day}`;
    userDays.set(key, (userDays.get(key) ?? 0) + row.costUsd);

    let user = perUser.get(row.userId);
    if (!user) {
      user = {
        cost: 0,
        tokens: 0,
        requests: 0,
        models: new Set(),
        lastSync: row.updatedAt,
      };
      perUser.set(row.userId, user);
    }
    user.cost += row.costUsd;
    user.tokens += tokens;
    user.requests += row.requests;
    user.models.add(modelId);
    if (row.updatedAt > user.lastSync) user.lastSync = row.updatedAt;
  }

  return {
    windowDays,
    users: {
      total: profiles.length,
      reporting: new Set(usage.map((row) => row.userId)).size,
      joinedThisWeek: profiles.filter((profile) => profile.createdAt >= weekAgo)
        .length,
      activeInWindow: perUser.size,
    },
    window: { ...window, daysWithUsage: days.size },
    allTime: {
      ...allTime,
      firstDay,
      models: allModels.size,
      days: allDays.size,
    },

    // Dense: a gap would misdraw the line, and a quiet day is real information.
    byDay: Array.from({ length: windowDays }, (_, index) => {
      const day = shiftDay(start, index);
      const entry = days.get(day);
      return {
        day,
        cost: entry?.cost ?? 0,
        tokens: entry?.tokens ?? 0,
        requests: entry?.requests ?? 0,
        input: entry?.input ?? 0,
        output: entry?.output ?? 0,
        cacheWrite: entry?.cacheWrite ?? 0,
        cacheRead: entry?.cacheRead ?? 0,
      };
    }),

    byModel: [...models.entries()]
      .map(([model, entry]) => ({
        model,
        cost: entry.cost,
        tokens: entry.tokens,
        requests: entry.requests,
        users: entry.users.size,
      }))
      .sort((a, b) => b.cost - a.cost),

    byTool: [...tools.entries()]
      .map(([tool, entry]) => ({
        tool,
        cost: entry.cost,
        tokens: entry.tokens,
        requests: entry.requests,
        users: entry.users.size,
      }))
      .sort((a, b) => b.cost - a.cost),

    records: {
      biggestDay: biggestUserDay(userDays, handleOf),
      mostRequests: best(perUser, handleOf, (user) => user.requests),
      mostModels: best(perUser, handleOf, (user) => user.models.size),
    },

    recentSyncs: [...perUser.entries()]
      .flatMap(([userId, user]) => {
        const handle = handleOf(userId);
        return handle ? [{ handle, at: user.lastSync }] : [];
      })
      .sort((a, b) => b.at.localeCompare(a.at))
      .slice(0, 8),
  };
}

/* ---------------------------------------------------------------- helpers */

/**
 * Resolve a user id to a handle, but only for accounts that agreed to be
 * named. Unlisted usage still counts toward the anonymous totals above; it
 * just never appears in the records or the sync feed.
 */
function handleLookup(profiles: Profile[]): (userId: string) => string | null {
  const byId = new Map(
    profiles.filter(listedFor).map((profile) => [profile.$id, profile.handle]),
  );
  return (userId) => byId.get(userId) ?? null;
}

function add(
  map: Map<string, Bucket>,
  key: string,
  cost: number,
  tokens: number,
  requests: number,
  split?: {
    input: number;
    output: number;
    cacheWrite: number;
    cacheRead: number;
  },
): void {
  const entry = map.get(key) ?? { cost: 0, tokens: 0, requests: 0 };
  entry.cost += cost;
  entry.tokens += tokens;
  entry.requests += requests;
  if (split) {
    entry.input = (entry.input ?? 0) + split.input;
    entry.output = (entry.output ?? 0) + split.output;
    entry.cacheWrite = (entry.cacheWrite ?? 0) + split.cacheWrite;
    entry.cacheRead = (entry.cacheRead ?? 0) + split.cacheRead;
  }
  map.set(key, entry);
}

function biggestUserDay(
  userDays: Map<string, number>,
  handleOf: (userId: string) => string | null,
): Highlight | null {
  let best: Highlight | null = null;

  for (const [key, cost] of userDays) {
    const [userId, day] = key.split(" ") as [string, string];
    const handle = handleOf(userId);
    if (!handle) continue;
    if (!best || cost > best.value) best = { handle, value: cost, detail: day };
  }

  return best;
}

function best(
  perUser: Map<string, UserAcc>,
  handleOf: (userId: string) => string | null,
  score: (user: UserAcc) => number,
): Highlight | null {
  let top: Highlight | null = null;

  for (const [userId, user] of perUser) {
    const handle = handleOf(userId);
    if (!handle) continue;
    const value = score(user);
    if (!top || value > top.value) top = { handle, value };
  }

  return top;
}
