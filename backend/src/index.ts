/**
 * tokn backend — Appwrite-backed persistence for the leaderboard.
 *
 * Import from here rather than reaching into `repo/` directly, so the storage
 * layer can change without touching route handlers.
 *
 *   import { syncUsage, leaderboard, authenticateDevice } from "tokn-backend";
 *
 * Layout:
 *   schema.ts     the collections, declared once
 *   provision.ts  creates whatever is missing (idempotent)
 *   ids.ts        deterministic row ids — the upsert invariant lives here
 *   repo/*        one module per collection
 *   service.ts    the operations a route actually performs
 */

export { ENV } from "./env.ts";
// Low-level access, for seeding and maintenance scripts that need to reach
// past the repositories. Application code should not use these.
export { DB_ID, db, Query, ID } from "./client.ts";
export { newId, hashToken, usageRowId, totalsRowId, pricingRowId } from "./ids.ts";
export { COLLECTIONS } from "./schema.ts";

export * from "./crypto.ts";
export * from "./repo/profiles.ts";
export * from "./repo/github.ts";
export * from "./repo/sessions.ts";
export * from "./repo/devices.ts";
export * from "./repo/passkeys.ts";
export * from "./repo/friends.ts";
export * from "./repo/usage.ts";
export * from "./repo/integrity.ts";
export * from "./repo/anatomy.ts";
export * from "./repo/whatif.ts";
export * from "./repo/leaderboard.ts";
export * from "./repo/pricing.ts";
export {
  pricingRefreshPlan,
  pricingTableForCli,
  refreshPricingFromCatalog,
} from "./refresh-pricing.ts";
export * from "./service.ts";
export * from "./passkey-service.ts";
