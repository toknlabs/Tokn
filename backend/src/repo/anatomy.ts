import { db, DB_ID, Query } from "../client.ts";
import { listUsage, type UsageDoc } from "./usage.ts";
import { pricingTable, type CliPrice } from "./pricing.ts";
import type { Totals } from "./leaderboard.ts";

/**
 * Where the money actually goes, and how well a user reuses what they paid to
 * cache.
 *
 * This exists because the intuition is wrong. Developers think "tokens" means
 * the prompt they typed and the reply they got. On a real Claude Code workload
 * those are a rounding error: cache is roughly nine tenths of the bill, and
 * output is under ten percent. No provider dashboard breaks it down this way,
 * because only the local session logs carry the per-bucket split.
 *
 * Two numbers come out of it:
 *
 *   anatomy    what each token bucket cost
 *   reuse      cached tokens read per cached token written
 *
 * Reuse is the actionable one. Writing to cache costs 1.25x the input rate at
 * a five-minute TTL and 2x at an hour; reading costs a tenth. A high ratio
 * means long sessions that keep re-reading a warm prefix. A low one means
 * paying the write premium again and again — starting over, clearing context,
 * or editing early turns and invalidating everything after them.
 */

export interface CostAnatomy {
  input: number;
  output: number;
  cacheWrite: number;
  cacheRead: number;
  total: number;
}

export interface TokenAnatomy {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  total: number;
}

export interface Reuse {
  /** Cached tokens read per cached token written. Higher is better. */
  ratio: number | null;
  cacheRead: number;
  cacheWrite: number;
  /** Share of spend that is cache, read and write together. 0-1. */
  cacheShareOfCost: number;
}

export interface Anatomy {
  cost: CostAnatomy;
  tokens: TokenAnatomy;
  reuse: Reuse;
}

const empty = (): Anatomy => ({
  cost: { input: 0, output: 0, cacheWrite: 0, cacheRead: 0, total: 0 },
  tokens: { input: 0, output: 0, cacheWrite5m: 0, cacheWrite1h: 0, cacheRead: 0, total: 0 },
  reuse: { ratio: null, cacheRead: 0, cacheWrite: 0, cacheShareOfCost: 0 },
});

/**
 * Split a user's spend across the four billed buckets.
 *
 * Each row is priced with its own model's real rates, then the buckets are
 * scaled so they sum to the `costUsd` the CLI already computed and the user
 * was already shown. Two figures for the same spend would be worse than none.
 *
 * The fallback weights are only for a model with no rate on file; they mirror
 * the shape of the rate card rather than any specific model.
 */
const WEIGHT = { input: 1, output: 5, cacheWrite5m: 1.25, cacheWrite1h: 2, cacheRead: 0.1 };

const CACHE_READ_MULT = 0.1;
const WRITE_5M_MULT = 1.25;
const WRITE_1H_MULT = 2.0;
const PER_MILLION = 1_000_000;

/** Per-bucket cost for one row, at that model's published rates. */
function priceRow(row: UsageDoc, price: CliPrice | undefined) {
  if (!price) {
    return {
      input: row.input * WEIGHT.input,
      output: row.output * WEIGHT.output,
      cacheWrite: row.cacheWrite5m * WEIGHT.cacheWrite5m + row.cacheWrite1h * WEIGHT.cacheWrite1h,
      cacheRead: row.cacheRead * WEIGHT.cacheRead,
    };
  }

  const readRate = price.cacheRead ?? price.input * CACHE_READ_MULT;
  const write5m = price.cacheWrite ?? price.input * WRITE_5M_MULT;
  const write1h = price.cacheWrite1h ?? price.input * WRITE_1H_MULT;

  return {
    input: (row.input / PER_MILLION) * price.input,
    output: (row.output / PER_MILLION) * price.output,
    cacheWrite:
      (row.cacheWrite5m / PER_MILLION) * write5m + (row.cacheWrite1h / PER_MILLION) * write1h,
    cacheRead: (row.cacheRead / PER_MILLION) * readRate,
  };
}

export function anatomyOf(rows: UsageDoc[], prices: Record<string, CliPrice> = {}): Anatomy {
  const out = empty();
  if (rows.length === 0) return out;

  for (const row of rows) {
    out.tokens.input += row.input;
    out.tokens.output += row.output;
    out.tokens.cacheWrite5m += row.cacheWrite5m;
    out.tokens.cacheWrite1h += row.cacheWrite1h;
    out.tokens.cacheRead += row.cacheRead;

    const priced = priceRow(row, prices[row.model]);
    const sum = priced.input + priced.output + priced.cacheWrite + priced.cacheRead;

    // Reconcile to the figure the user was already shown. Rates can move
    // between a sync and a page load; the stored cost is the one of record.
    // A row with no priced tokens contributes nothing rather than dividing by
    // zero, and its cost lands in the total only.
    if (sum > 0) {
      const scale = row.costUsd / sum;
      out.cost.input += priced.input * scale;
      out.cost.output += priced.output * scale;
      out.cost.cacheWrite += priced.cacheWrite * scale;
      out.cost.cacheRead += priced.cacheRead * scale;
    }
    out.cost.total += row.costUsd;
  }

  const t = out.tokens;
  t.total = t.input + t.output + t.cacheWrite5m + t.cacheWrite1h + t.cacheRead;

  const written = t.cacheWrite5m + t.cacheWrite1h;
  out.reuse = {
    // Below a floor the ratio is noise: a handful of requests can read a big
    // prefix once and look extraordinary.
    ratio: written > 10_000 ? t.cacheRead / written : null,
    cacheRead: t.cacheRead,
    cacheWrite: written,
    cacheShareOfCost:
      out.cost.total > 0 ? (out.cost.cacheRead + out.cost.cacheWrite) / out.cost.total : 0,
  };

  return out;
}

export async function anatomyFor(userId: string, since?: string): Promise<Anatomy> {
  const [rows, prices] = await Promise.all([
    listUsage(userId, since ? { since } : {}),
    pricingTable(),
  ]);
  return anatomyOf(rows, prices);
}

/* ------------------------------------------------------------ comparison */

export interface ReuseBenchmark {
  /** The user's own ratio, or null when they have too little cache traffic. */
  ratio: number | null;
  median: number | null;
  /** Percentile 0-100 among users with a comparable ratio. */
  percentile: number | null;
  /**
   * Place in the cohort, 1 for the best ratio. Easier to read than a
   * percentile in a small cohort, where "40th percentile" can sit exactly on
   * the median.
   */
  rank: number | null;
  /** How many users the comparison is drawn from. */
  cohort: number;
  /**
   * Dollars this user would have kept at the median ratio. Null when they are
   * already at or above it — there is no saving to claim, and inventing one
   * would be the kind of number nobody should trust.
   */
  headroomUsd: number | null;
}

/**
 * Compare one user's reuse against everyone else's.
 *
 * Reads `user_totals`, which carries the aggregate cache figures, so this is
 * one query rather than a scan of every usage row.
 */
export async function reuseBenchmark(
  userId: string,
  own: Anatomy,
): Promise<ReuseBenchmark> {
  const ratios: number[] = [];
  let cursor: string | undefined;

  for (;;) {
    const queries = [Query.limit(100), Query.orderAsc("$id"), Query.greaterThan("cacheWrite", 0)];
    if (cursor) queries.push(Query.cursorAfter(cursor));

    const page = await db().listDocuments(DB_ID, "user_totals", queries);
    const docs = page.documents as unknown as (Totals & {
      cacheRead?: number;
      cacheWrite?: number;
    })[];

    for (const row of docs) {
      const written = row.cacheWrite ?? 0;
      const read = row.cacheRead ?? 0;
      if (written > 10_000) ratios.push(read / written);
    }

    if (docs.length < 100) break;
    cursor = docs[docs.length - 1]?.$id;
    if (!cursor) break;
  }

  const ratio = own.reuse.ratio;

  // Below a handful of people a "median" and a "percentile" are theatre.
  if (ratios.length < 5 || ratio === null) {
    return { ratio, median: null, percentile: null, rank: null, cohort: ratios.length, headroomUsd: null };
  }

  ratios.sort((a, b) => a - b);
  const median = ratios[Math.floor(ratios.length / 2)] ?? 0;
  const below = ratios.filter((r) => r < ratio).length;
  const percentile = Math.round((below / ratios.length) * 100);
  const rank = ratios.filter((r) => r > ratio).length + 1;

  return {
    ratio,
    median,
    percentile,
    rank,
    cohort: ratios.length,
    headroomUsd: ratio >= median ? null : headroom(own, median),
  };
}

/**
 * What the same work would have cost at a given reuse ratio.
 *
 * Holds cache reads fixed — that is the work actually being done — and asks
 * what the writes would have been to support them. The difference is the write
 * premium paid for re-establishing context that could have stayed warm.
 */
function headroom(own: Anatomy, targetRatio: number): number | null {
  const { cacheRead, cacheWrite } = own.reuse;
  if (cacheWrite <= 0 || cacheRead <= 0 || targetRatio <= 0) return null;

  const wouldWrite = cacheRead / targetRatio;
  if (wouldWrite >= cacheWrite) return null;

  const perToken = own.cost.cacheWrite / cacheWrite;
  const saved = (cacheWrite - wouldWrite) * perToken;

  // Under a dollar it is not worth anybody's attention.
  return saved >= 1 ? saved : null;
}

/* ---------------------------------------------------------- burn rate */

export interface BurnRate {
  /** Mean daily spend over the trailing window, active days only. */
  perDay: number;
  /** Spend so far this calendar month. */
  monthToDate: number;
  /** Month-end figure if the trailing pace holds. Null too early to say. */
  projected: number | null;
  daysRemaining: number;
}

export function burnRate(
  byDay: { day: string; costUsd: number }[],
  now = new Date(),
): BurnRate {
  const month = now.toISOString().slice(0, 7);
  const monthToDate = byDay
    .filter((d) => d.day.startsWith(month))
    .reduce((sum, d) => sum + d.costUsd, 0);

  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const dayOfMonth = now.getDate();
  const daysRemaining = daysInMonth - dayOfMonth;

  // Trailing fortnight, including zero days: someone who works three days a
  // week should not be projected as though they work seven.
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - 13);
  const from = cutoff.toISOString().slice(0, 10);

  const window = byDay.filter((d) => d.day >= from);
  const spend = window.reduce((sum, d) => sum + d.costUsd, 0);
  const perDay = spend / 14;

  return {
    perDay,
    monthToDate,
    // Two days of history cannot forecast a month.
    projected: window.length >= 3 ? monthToDate + perDay * daysRemaining : null,
    daysRemaining,
  };
}
