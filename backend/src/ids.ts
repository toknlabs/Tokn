import crypto from "node:crypto";

/**
 * Row identifiers.
 *
 * Appwrite has no composite primary key and no `ON CONFLICT`. The way to get
 * upsert semantics is to make the row id a pure function of the natural key:
 * the same (user, day, tool, model, fast) always addresses the same row, so a
 * re-sync overwrites it instead of appending a duplicate.
 *
 * This is the single most important invariant in the schema. `tokn sync`
 * re-uploads the user's whole history every run; if these ids were random,
 * the second sync would double every number on the leaderboard.
 *
 * Appwrite ids allow [a-zA-Z0-9._-], may not start with a special character,
 * and are capped at 36 characters.
 */

const MAX_ID = 36;

function sha(input: string, length: number): string {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, length);
}

/** Deterministic id for one usage bucket. */
export function usageRowId(
  userId: string,
  day: string,
  tool: string,
  model: string,
  fast: boolean,
): string {
  // Hashed rather than concatenated: model ids run long and contain characters
  // Appwrite would reject, and the natural key exceeds 36 chars on its own.
  return `u${sha(`${userId}|${day}|${tool}|${model}|${fast ? 1 : 0}`, MAX_ID - 1)}`;
}

/**
 * Deterministic id for one day of agent runs. Same reasoning as `usageRowId`:
 * the app re-sends its whole history, so the same (user, day, tool) has to land
 * on the same row or every re-sync would add the day again.
 */
export function agentRowId(userId: string, day: string, tool: string): string {
  return `a${sha(`${userId}|${day}|${tool}`, MAX_ID - 1)}`;
}

/** Totals are one row per user, addressed directly by user id. */
export function totalsRowId(userId: string): string {
  return userId.length <= MAX_ID ? userId : `t${sha(userId, MAX_ID - 1)}`;
}

/**
 * Pricing rows are addressed by model id where it fits the id rules, so the
 * table stays readable in the Appwrite console.
 */
export function pricingRowId(modelId: string): string {
  const safe = modelId.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  if (safe.length > 0 && safe.length <= MAX_ID && /^[a-z0-9]/.test(safe)) return safe;
  return `m${sha(modelId.toLowerCase(), MAX_ID - 1)}`;
}

/** A readable prefixed id for rows with no natural key. */
export function newId(prefix: string): string {
  const random = crypto.randomBytes(16).toString("hex");
  return `${prefix}${random}`.slice(0, MAX_ID);
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
