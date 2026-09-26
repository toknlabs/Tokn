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
 * For scale, the heaviest real day observed while building this was about
 * 400M tokens and 600 requests for a single model. These sit far above that:
 * they are here to stop the absurd, not to police the enthusiastic.
 */
const LIMITS = {
  /** One request cannot carry more than a context window plus its output, and
   *  the largest windows are a few million tokens. */
  tokensPerRequest: 20_000_000,
  /** One agent making a request every second all day is ~86k. */
  requestsPerRow: 250_000,
  /** A single (day, tool, model) bucket. */
  tokensPerRow: 50_000_000_000,
  /** Everything one sync claims, across every row. */
  tokensPerSync: 200_000_000_000,
  /** A day that far in the past is a clock problem or a fabricated backfill. */
  maxAgeDays: 400,
} as const;

export type RejectReason =
  | "unpriceable-model"
  | "tokens-per-request"
  | "requests-per-row"
  | "tokens-per-row"
  | "tokens-without-requests"
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

/**
 * Check a batch and reprice it.
 *
 * Rejection is per row: one bad row does not cost someone an otherwise honest
 * sync, and the CLI is told exactly which rows went and why the others did not.
 * Silently dropping them would leave an honest user staring at a total that
 * does not match their machine with no way to find out why.
 */
export async function assess(rows: SyncRow[], prices?: Record<string, CliPrice>): Promise<Assessment> {
  const rateTable = prices ?? (await pricingTable());
  const out: SyncRow[] = [];
  const rejected: Rejected[] = [];
  let costUsd = 0;
  let total = 0;

  const oldest = new Date(Date.now() - LIMITS.maxAgeDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  for (const row of rows) {
    const tokens = tokensIn(row);
    const reject = (reason: RejectReason, detail: string) =>
      rejected.push({ day: row.day, model: row.model, reason, detail });

    if (row.day < oldest) {
      reject("too-old", `${row.day} is older than ${LIMITS.maxAgeDays} days`);
      continue;
    }

    // Tokens exist because a request produced them. Counts without any request
    // to have produced them are the signature of a hand-written payload.
    if (tokens > 0 && row.requests === 0) {
      reject("tokens-without-requests", `${tokens.toLocaleString()} tokens, 0 requests`);
      continue;
    }

    if (row.requests > LIMITS.requestsPerRow) {
      reject("requests-per-row", `${row.requests.toLocaleString()} requests in one day`);
      continue;
    }

    if (tokens > LIMITS.tokensPerRow) {
      reject("tokens-per-row", `${tokens.toLocaleString()} tokens in one day`);
      continue;
    }

    if (row.requests > 0) {
      const per = tokens / row.requests;
      if (per > LIMITS.tokensPerRequest) {
        reject(
          "tokens-per-request",
          `${Math.round(per).toLocaleString()} tokens per request`,
        );
        continue;
      }
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

    total += tokens;
    const priced = priceOf(row, price);
    costUsd += priced;
    // The client's own costUsd is discarded here, not merely checked. This one
    // line is what makes the leaderboard's ranking metric unforgeable from the
    // client.
    out.push({ ...row, costUsd: priced });
  }

  return {
    rows: total > LIMITS.tokensPerSync ? [] : out,
    rejected,
    costUsd,
    overSyncLimit: total > LIMITS.tokensPerSync,
  };
}

export const INTEGRITY_LIMITS = LIMITS;
