/**
 * The tokn schema, declared once.
 *
 * Everything lives in its own Appwrite database (`tokn` by default), separate
 * from anything else in the project, so the leaderboard's tables cannot collide
 * with unrelated collections and can be backed up or dropped as a unit.
 *
 * `provision.ts` reads this and creates whatever is missing. It is additive and
 * safe to re-run: existing collections, attributes and indexes are left alone.
 */

export type Attribute =
  | { key: string; type: "string"; size: number; required?: boolean; default?: string; array?: boolean }
  | { key: string; type: "integer"; required?: boolean; default?: number; min?: number; max?: number }
  | { key: string; type: "float"; required?: boolean; default?: number; min?: number; max?: number }
  | { key: string; type: "boolean"; required?: boolean; default?: boolean }
  | { key: string; type: "datetime"; required?: boolean }
  | { key: string; type: "enum"; elements: string[]; required?: boolean; default?: string };

export interface Index {
  key: string;
  type: "key" | "unique";
  attributes: string[];
  orders?: ("ASC" | "DESC")[];
}

export interface Collection {
  id: string;
  name: string;
  /** Why this collection exists — kept with the schema, not in a wiki. */
  purpose: string;
  attributes: Attribute[];
  indexes: Index[];
}

/**
 * Appwrite integer attributes default to a 32-bit maximum. Token counters blow
 * straight through that — a single active user reached 15.6 billion tokens in
 * testing — so every counter declares an explicit ceiling at JavaScript's
 * safe-integer limit.
 */
export const MAX_COUNT = Number.MAX_SAFE_INTEGER;

const counter = (key: string): Attribute => ({
  key,
  type: "integer",
  required: false,
  default: 0,
  min: 0,
  max: MAX_COUNT,
});

export const COLLECTIONS: Collection[] = [
  {
    id: "profiles",
    name: "Profiles",
    purpose: "One row per account. The handle is the public identity on the leaderboard.",
    attributes: [
      { key: "handle", type: "string", size: 24, required: true },
      // Lowercased copy so uniqueness and lookups are case-insensitive;
      // Appwrite indexes have no collation option.
      { key: "handleLower", type: "string", size: 24, required: true },
      { key: "name", type: "string", size: 64 },
      { key: "bio", type: "string", size: 280 },
      { key: "passwordHash", type: "string", size: 256, required: true },
      // "api" bills at raw API rates, "subscription" at plan rates.
      { key: "billing", type: "enum", elements: ["api", "subscription"], default: "api" },
      // JSON array of profile URLs (GitHub, X, a personal site).
      { key: "links", type: "string", size: 1024 },
      { key: "avatarUrl", type: "string", size: 512 },
      { key: "isPublic", type: "boolean", default: true },
      // Whether to appear on the leaderboard. Independent of `isPublic`: a
      // public profile may opt out of being ranked. A private one is never
      // listed, which `listedFor` enforces on write.
      { key: "listed", type: "boolean", default: true },
      // How many times the handle has been changed. Capped, because the handle
      // is the public identity and inbound links point at it.
      { key: "handleChanges", type: "integer", default: 0, min: 0, max: 100 },
      // JSON array of the subscriptions and API accounts this person pays for.
      // Declared, not measured: nothing verifies it, and the profile says so.
      { key: "plans", type: "string", size: 1024 },
      // JSON blob of profile appearance choices: accent, avatar style, which
      // blocks show and in what order. Presentation only — nothing here
      // changes what is measured.
      { key: "prefs", type: "string", size: 1024 },
      { key: "createdAt", type: "datetime", required: true },
      // GitHub sign-in. `githubId` is GitHub's immutable numeric id — the login
      // name can be changed by its owner, so it must never be the join key.
      { key: "githubId", type: "string", size: 32 },
      { key: "githubLogin", type: "string", size: 64 },
    ],
    indexes: [
      { key: "handleLower_unique", type: "unique", attributes: ["handleLower"] },
      { key: "createdAt_idx", type: "key", attributes: ["createdAt"], orders: ["DESC"] },
      { key: "githubId_idx", type: "key", attributes: ["githubId"] },
    ],
  },

  {
    id: "passkeys",
    name: "Passkeys",
    purpose:
      "WebAuthn credentials. Only public keys are stored — a passkey cannot be used from this data, and there is no shared secret to leak.",
    attributes: [
      { key: "userId", type: "string", size: 36, required: true },
      // Base64url of the raw credential id, as the authenticator returns it.
      { key: "credentialId", type: "string", size: 512, required: true },
      { key: "publicKey", type: "string", size: 1024, required: true },
      // Signature counter. A value that goes backwards means a cloned
      // authenticator, which is the one thing this field is for.
      { key: "counter", type: "integer", default: 0, min: 0, max: MAX_COUNT },
      // JSON array: "internal", "hybrid", "usb"… used only as a UI hint.
      { key: "transports", type: "string", size: 256 },
      { key: "label", type: "string", size: 64 },
      { key: "createdAt", type: "datetime", required: true },
      { key: "lastUsedAt", type: "datetime" },
    ],
    indexes: [
      { key: "credentialId_unique", type: "unique", attributes: ["credentialId"] },
      { key: "userId_idx", type: "key", attributes: ["userId"] },
    ],
  },

  {
    id: "sessions",
    name: "Browser sessions",
    purpose: "Cookie-backed dashboard sessions. Distinct from CLI device tokens.",
    attributes: [
      { key: "userId", type: "string", size: 36, required: true },
      { key: "createdAt", type: "datetime", required: true },
      { key: "expiresAt", type: "datetime", required: true },
    ],
    indexes: [
      { key: "userId_idx", type: "key", attributes: ["userId"] },
      { key: "expiresAt_idx", type: "key", attributes: ["expiresAt"] },
    ],
  },

  {
    id: "devices",
    name: "CLI devices",
    purpose:
      "One row per machine running the CLI. Only a SHA-256 of the token is stored, so a leaked database cannot sync as anyone.",
    attributes: [
      { key: "userId", type: "string", size: 36, required: true },
      { key: "tokenHash", type: "string", size: 64, required: true },
      { key: "hostname", type: "string", size: 128 },
      { key: "platform", type: "string", size: 32 },
      { key: "cliVersion", type: "string", size: 32 },
      { key: "linkedAt", type: "datetime", required: true },
      { key: "lastSyncAt", type: "datetime" },
      { key: "revokedAt", type: "datetime" },
    ],
    indexes: [
      { key: "tokenHash_unique", type: "unique", attributes: ["tokenHash"] },
      { key: "userId_idx", type: "key", attributes: ["userId"] },
    ],
  },

  {
    id: "link_codes",
    name: "Link codes",
    purpose:
      "Short-lived single-use codes shown on the dashboard and pasted into the CLI. Expire in minutes.",
    attributes: [
      { key: "code", type: "string", size: 9, required: true },
      { key: "userId", type: "string", size: 36, required: true },
      { key: "createdAt", type: "datetime", required: true },
      { key: "expiresAt", type: "datetime", required: true },
      { key: "consumedAt", type: "datetime" },
      { key: "deviceId", type: "string", size: 36 },
    ],
    indexes: [
      { key: "code_unique", type: "unique", attributes: ["code"] },
      { key: "userId_idx", type: "key", attributes: ["userId"] },
      { key: "expiresAt_idx", type: "key", attributes: ["expiresAt"] },
    ],
  },

  {
    id: "usage_daily",
    name: "Daily usage",
    purpose:
      "The core table: one row per (user, day, tool, model, fast). Row ids are derived from that key so a re-sync replaces a row instead of adding one.",
    attributes: [
      { key: "userId", type: "string", size: 36, required: true },
      { key: "day", type: "string", size: 10, required: true },
      // The tool dimension is what keeps Claude Code and Copilot usage of the
      // same model on the same day from overwriting each other.
      { key: "tool", type: "string", size: 32, required: true },
      { key: "model", type: "string", size: 120, required: true },
      { key: "fast", type: "boolean", default: false },
      counter("requests"),
      counter("input"),
      counter("output"),
      counter("cacheWrite5m"),
      counter("cacheWrite1h"),
      counter("cacheRead"),
      { key: "costUsd", type: "float", default: 0, min: 0, max: 1_000_000 },
      { key: "updatedAt", type: "datetime", required: true },
    ],
    indexes: [
      { key: "user_day_idx", type: "key", attributes: ["userId", "day"] },
      { key: "day_idx", type: "key", attributes: ["day"], orders: ["DESC"] },
      { key: "user_idx", type: "key", attributes: ["userId"] },
      { key: "tool_idx", type: "key", attributes: ["tool"] },
      { key: "model_idx", type: "key", attributes: ["model"] },
    ],
  },

  {
    id: "agent_daily",
    name: "Daily agent runs",
    purpose:
      "One row per (user, day, tool): how many agent runs an app started that day and how long they ran. Sent by Eaon Desktop alongside its usage rows; the CLI has no notion of an agent run and never writes here. Row ids derive from the key, so a re-sync replaces a day rather than adding it again.",
    attributes: [
      { key: "userId", type: "string", size: 36, required: true },
      { key: "day", type: "string", size: 10, required: true },
      { key: "tool", type: "string", size: 32, required: true },
      // Ceilings match the validation in repo/agents.ts, so a value the sync
      // would refuse could not be written by hand either.
      { key: "runs", type: "integer", default: 0, min: 0, max: 100_000 },
      counter("totalMs"),
      { key: "longestMs", type: "integer", default: 0, min: 0, max: 604_800_000 },
      { key: "updatedAt", type: "datetime", required: true },
    ],
    indexes: [
      { key: "user_day_tool_unique", type: "unique", attributes: ["userId", "day", "tool"] },
      { key: "user_idx", type: "key", attributes: ["userId"] },
      { key: "day_idx", type: "key", attributes: ["day"], orders: ["DESC"] },
      { key: "tool_idx", type: "key", attributes: ["tool"] },
    ],
  },

  {
    id: "user_totals",
    name: "User totals",
    purpose:
      "Denormalised rollup, one row per user, refreshed on every sync. The leaderboard reads this instead of scanning usage_daily, which would not scale past a few thousand users.",
    attributes: [
      { key: "userId", type: "string", size: 36, required: true },
      { key: "handle", type: "string", size: 24, required: true },
      { key: "handleLower", type: "string", size: 24, required: true },
      { key: "isPublic", type: "boolean", default: true },
      { key: "listed", type: "boolean", default: true },
      { key: "costUsd", type: "float", default: 0, min: 0, max: 100_000_000 },
      counter("tokens"),
      counter("requests"),
      counter("activeDays"),
      // Aggregate cache traffic, so reuse can be compared across users with a
      // single indexed query instead of re-reading everyone's raw rows.
      counter("cacheRead"),
      counter("cacheWrite"),
      // Rolling windows, so the leaderboard can offer "this week" and "this
      // month" without recomputing from raw rows on every page load.
      { key: "costUsd7d", type: "float", default: 0, min: 0, max: 100_000_000 },
      { key: "costUsd30d", type: "float", default: 0, min: 0, max: 100_000_000 },
      { key: "firstDay", type: "string", size: 10 },
      { key: "lastDay", type: "string", size: 10 },
      { key: "topModel", type: "string", size: 120 },
      { key: "topTool", type: "string", size: 32 },
      { key: "toolCount", type: "integer", default: 0, min: 0, max: 1000 },
      { key: "lastSyncAt", type: "datetime" },
      { key: "updatedAt", type: "datetime", required: true },
    ],
    indexes: [
      { key: "handleLower_unique", type: "unique", attributes: ["handleLower"] },
      { key: "cost_idx", type: "key", attributes: ["costUsd"], orders: ["DESC"] },
      { key: "cost7d_idx", type: "key", attributes: ["costUsd7d"], orders: ["DESC"] },
      { key: "cost30d_idx", type: "key", attributes: ["costUsd30d"], orders: ["DESC"] },
      { key: "cachewrite_idx", type: "key", attributes: ["cacheWrite"] },
      { key: "tokens_idx", type: "key", attributes: ["tokens"], orders: ["DESC"] },
      { key: "public_idx", type: "key", attributes: ["isPublic"] },
      { key: "listed_idx", type: "key", attributes: ["listed"] },
    ],
  },

  {
    id: "friendships",
    name: "Friendships",
    purpose:
      "One row per pair, not per direction. The row id is derived from the two user ids sorted, so a request in either direction addresses the same row and a duplicate is impossible.",
    attributes: [
      // Sorted, so (a,b) and (b,a) are the same row. Which of the two asked is
      // recorded separately.
      { key: "userA", type: "string", size: 36, required: true },
      { key: "userB", type: "string", size: 36, required: true },
      { key: "requestedBy", type: "string", size: 36, required: true },
      { key: "status", type: "enum", elements: ["pending", "accepted"], required: true },
      { key: "createdAt", type: "datetime", required: true },
      { key: "respondedAt", type: "datetime" },
    ],
    indexes: [
      { key: "userA_idx", type: "key", attributes: ["userA"] },
      { key: "userB_idx", type: "key", attributes: ["userB"] },
      { key: "status_idx", type: "key", attributes: ["status"] },
    ],
  },

  {
    id: "pricing",
    name: "Model pricing",
    purpose:
      "Rates served to the CLI at GET /api/cli/pricing, in USD per million tokens. Lets a newly released model be priced without shipping a new CLI.",
    attributes: [
      { key: "modelId", type: "string", size: 120, required: true },
      { key: "provider", type: "string", size: 48 },
      { key: "input", type: "float", required: true, min: 0, max: 10_000 },
      { key: "output", type: "float", required: true, min: 0, max: 10_000 },
      { key: "cacheRead", type: "float", min: 0, max: 10_000 },
      { key: "cacheWrite", type: "float", min: 0, max: 10_000 },
      // Anthropic's 1-hour cache tier. No other provider exposes one, and
      // collapsing it into the 5-minute rate understates real agent workloads
      // badly — most cache writes in practice are 1h.
      { key: "cacheWrite1h", type: "float", min: 0, max: 10_000 },
      { key: "fastInput", type: "float", min: 0, max: 10_000 },
      { key: "fastOutput", type: "float", min: 0, max: 10_000 },
      { key: "updatedAt", type: "datetime", required: true },
    ],
    indexes: [{ key: "modelId_unique", type: "unique", attributes: ["modelId"] }],
  },
];
