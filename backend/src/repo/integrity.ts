import { normalizeModelId } from "../../../pricing/catalog.ts";
import type { SyncRow } from "./usage.ts";
import { pricingTable, type CliPrice } from "./pricing.ts";

/**
 * What the server refuses to take on faith from a CLI.
 *
 * ## The threat, stated honestly
 *
 * The CLI runs on a machine its user controls. They can read the binary,
 * extract anything embedded in it, and skip it entirely by posting to the API
 * by hand. No signature, checksum, obfuscation or attestation generated on
 * that machine can change this: whoever owns the machine owns the thing
 * producing the proof. Anyone claiming to have solved this for a client-side
 * agent is selling something.
 *
 * So this file does not try to prove a submission is genuine. It makes
 * fabrication *bounded* and *cheap to spot*, on the only principle that
 * survives an attacker controlling the client:
 *
 *   **Never store a number the client could have chosen freely.**
 *
 * ## What that buys
 *
 * Cost was the whole game, because cost is what the board ranks on. It used to
 * be whatever the client said it was, so `{tokens: 1, costUsd: 9e9}` would have
 * taken first place. Cost is now *derived* on the server from token counts and
 * the server's own price table, and the client's figure is discarded unread.
 * That reduces the attack surface from "claim any dollar amount" to "claim
 * token counts", which is a far smaller space and one with physical limits —
 * enforced below.
 *
 * ## What it does not buy
 *
 * Someone determined can still submit plausible-but-invented token counts
 * inside these bounds. The defence there is not arithmetic, it is that the
 * bounds cap the payoff, every row keeps the device that sent it, and
 * anomalies are recorded rather than silently absorbed.
 */

const PER_MILLION = 1_000_000;
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_5M_MULTIPLIER = 1.25;
const CACHE_WRITE_1H_MULTIPLIER = 2.0;

/**
 * Physical ceilings, set roughly an order of magnitude above anything real so
 * that a heavy genuine day is never touched.
 *
 * For scale, measured across every public profile on 2026-10-30: the heaviest
 * real day was 1.6B tokens, 7.0M of them output, priced at $645. These sit far
 * above that: they are here to stop the absurd, not to police the
 * enthusiastic.
 */
const LIMITS = {
  /** One request cannot carry more than a context window plus its output, and
   *  the largest windows are a few million tokens. */
  tokensPerRequest: 20_000_000,
  /** Output is written a token at a time, and no model accepts a `max_tokens`
   *  above 128K. The headroom is for old Codex transcripts, which report a
   *  whole session as a single reading. */
  outputPerRequest: 1_000_000,
  /** One agent making a request every second all day is ~86k. */
  requestsPerRow: 250_000,
  /**
   * The rest are one account's whole day, across every tool, model and device.
   *
   * Per-row limits alone cap nothing: every tool name and every priced model is
   * its own row, so a forged day spread thinly enough clears each one. The day
   * is where the payoff is actually bounded.
   */
  tokensPerDay: 20_000_000_000,
  /** Output is what a forged total is cheapest to build from: it is the dearest
   *  kind, 100x a cache read on the same model, and the scarcest, since it is
   *  generated rather than re-read. The real peak is 7M. */
  outputPerDay: 50_000_000,
  /** In the server's own prices. A backstop for spend built from any mix. */
  costPerDayUsd: 5_000,
  /** Everything one sync claims, across every row. */
  tokensPerSync: 200_000_000_000,
  /** A day that far in the past is a clock problem or a fabricated backfill. */
  maxAgeDays: 400,
} as const;

export type RejectReason =
  | "unpriceable-model"
  | "tokens-per-request"
  | "output-per-request"
  | "requests-per-row"
  | "tokens-without-requests"
  | "tokens-per-day"
  | "output-per-day"
  | "cost-per-day"
  | "too-old";

export interface Rejected {
  day: string;
  model: string;
  reason: RejectReason;
  /** The measurement that failed, so the CLI can say something specific. */
  detail: string;
}

export interface Assessment {
  /** Rows that passed, with `costUsd` replaced by the server's own figure. */
  rows: SyncRow[];
  rejected: Rejected[];
  /** Sum of the server-computed cost, for logging and for the response. */
  costUsd: number;
  /** True when the whole payload blew the aggregate ceiling. */
  overSyncLimit: boolean;
}

/**
 * Price a row from token counts alone.
 *
 * Deliberately mirrors the arithmetic in `whatif.ts` rather than sharing it:
 * that one is a hypothetical for display, this one decides what gets stored,
 * and the two should not drift into each other by accident.
 */
function priceOf(row: SyncRow, price: CliPrice): number {
  const rates =
    row.fast && price.fast
      ? { input: price.fast.input, output: price.fast.output }
      : { input: price.input, output: price.output };

  const read = price.cacheRead ?? price.input * CACHE_READ_MULTIPLIER;
  const write5m = price.cacheWrite ?? price.input * CACHE_WRITE_5M_MULTIPLIER;
  const write1h = price.cacheWrite1h ?? price.input * CACHE_WRITE_1H_MULTIPLIER;

  return (
    (row.input / PER_MILLION) * rates.input +
    (row.output / PER_MILLION) * rates.output +
    (row.cacheWrite5m / PER_MILLION) * write5m +
    (row.cacheWrite1h / PER_MILLION) * write1h +
    (row.cacheRead / PER_MILLION) * read
  );
}

function tokensIn(row: SyncRow): number {
  return row.input + row.output + row.cacheWrite5m + row.cacheWrite1h + row.cacheRead;
}

/** The storage key, as `usageRowId` builds it: a row with the same one replaces it. */
function bucketOf(row: SyncRow): string {
  return `${row.tool}\u0000${row.model}\u0000${row.fast}`;
}

export interface Breach {
  reason: RejectReason;
  detail: string;
}

/**
 * The checks one row fails on its own, whatever else was sent with it.
 *
 * Pricing and age are left to `assess`: a stored row whose model later loses
 * its price, or that has simply grown old, is still honest history, and the
 * audit script runs this over stored rows.
 */
export function implausible(row: SyncRow): Breach | null {
  const tokens = tokensIn(row);

  // Tokens exist because a request produced them. Counts without any request
  // to have produced them are the signature of a hand-written payload.
  if (tokens > 0 && row.requests === 0) {
    return { reason: "tokens-without-requests", detail: `${tokens.toLocaleString()} tokens, 0 requests` };
  }

  if (row.requests > LIMITS.requestsPerRow) {
    return { reason: "requests-per-row", detail: `${row.requests.toLocaleString()} requests in one day` };
  }

  if (row.requests > 0) {
    const per = tokens / row.requests;
    if (per > LIMITS.tokensPerRequest) {
      return { reason: "tokens-per-request", detail: `${Math.round(per).toLocaleString()} tokens per request` };
    }

    const output = row.output / row.requests;
    if (output > LIMITS.outputPerRequest) {
      return {
        reason: "output-per-request",
        detail: `${Math.round(output).toLocaleString()} output tokens per request`,
      };
    }
  }

  return null;
}

/**
 * Whether one account's rows for a single day, taken together, are past what
 * one account can produce. `costUsd` must already be the server's figure.
 */
export function overDay(rows: SyncRow[]): Breach | null {
  let tokens = 0;
  let output = 0;
  let cost = 0;
  for (const row of rows) {
    tokens += tokensIn(row);
    output += row.output;
    cost += row.costUsd;
  }

  if (output > LIMITS.outputPerDay) {
    return { reason: "output-per-day", detail: `${output.toLocaleString()} output tokens across the day` };
  }
  if (tokens > LIMITS.tokensPerDay) {
    return { reason: "tokens-per-day", detail: `${tokens.toLocaleString()} tokens across the day` };
  }
  if (cost > LIMITS.costPerDayUsd) {
    return { reason: "cost-per-day", detail: `$${Math.round(cost).toLocaleString()} across the day` };
  }
  return null;
}

function byDay(rows: SyncRow[]): Map<string, SyncRow[]> {
  const days = new Map<string, SyncRow[]>();
  for (const row of rows) {
    const day = days.get(row.day);
    if (day) day.push(row);
    else days.set(row.day, [row]);
  }
  return days;
}

/**
 * Check a batch and reprice it.
 *
 * Rejection is per row: one bad row does not cost someone an otherwise honest
 * sync, and the CLI is told exactly which rows went and why the others did not.
 * Silently dropping them would leave an honest user staring at a total that
 * does not match their machine with no way to find out why.
 *
 * `stored` is what the account already has. The day ceilings count it, or a
 * forged day could arrive one row per sync under a different bucket each time.
 */
export async function assess(
  rows: SyncRow[],
  options: { prices?: Record<string, CliPrice>; stored?: SyncRow[] } = {},
): Promise<Assessment> {
  const rateTable = options.prices ?? (await pricingTable());
  const out: SyncRow[] = [];
  const rejected: Rejected[] = [];
  let total = 0;

  const oldest = new Date(Date.now() - LIMITS.maxAgeDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  for (const row of rows) {
    const reject = (reason: RejectReason, detail: string) =>
      rejected.push({ day: row.day, model: row.model, reason, detail });

    if (row.day < oldest) {
      reject("too-old", `${row.day} is older than ${LIMITS.maxAgeDays} days`);
      continue;
    }

    const breach = implausible(row);
    if (breach) {
      reject(breach.reason, breach.detail);
      continue;
    }

    // A model with no published rate cannot be priced honestly. Storing it at
    // an invented cost would be worse than storing nothing, and storing it at
    // zero would quietly let an unpriced model carry unlimited tokens onto the
    // board for free.
    const price = rateTable[row.model] ?? rateTable[normalizeModelId(row.model)];
    if (!price) {
      reject("unpriceable-model", `no published rate for ${row.model}`);
      continue;
    }

    total += tokensIn(row);
    // The client's own costUsd is discarded here, not merely checked. This one
    // line is what makes the leaderboard's ranking metric unforgeable from the
    // client.
    out.push({ ...row, costUsd: priceOf(row, price) });
  }

  // Then each day whole: what this sync brings for it, plus what is already
  // stored for it under a bucket this sync does not overwrite. Over a ceiling,
  // the whole day goes. Nothing here can tell which of its rows is the
  // invented one, and keeping any of them would let the rest back in later.
  const stored = byDay(options.stored ?? []);
  const overDays = new Set<string>();
  for (const [day, fresh] of byDay(out)) {
    const replaced = new Set(fresh.map(bucketOf));
    const kept = (stored.get(day) ?? []).filter((row) => !replaced.has(bucketOf(row)));
    const breach = overDay([...fresh, ...kept]);
    if (!breach) continue;

    overDays.add(day);
    for (const row of fresh) {
      rejected.push({ day, model: row.model, reason: breach.reason, detail: breach.detail });
    }
  }

  const accepted = out.filter((row) => !overDays.has(row.day));

  return {
    rows: total > LIMITS.tokensPerSync ? [] : accepted,
    rejected,
    costUsd: accepted.reduce((sum, row) => sum + row.costUsd, 0),
    overSyncLimit: total > LIMITS.tokensPerSync,
  };
}

export const INTEGRITY_LIMITS = LIMITS;
