import "server-only";
import { ENV } from "./backend";

/**
 * Whether this account runs the site, and so may open the owner pages. Set by
 * `TOKN_OWNER_IDS` (see `parseOwnerIds`); to everyone else those pages are a
 * 404, so nobody learns they exist.
 */
export function isOwner(userId: string | null | undefined): boolean {
  return Boolean(userId) && ENV.ownerIds.includes(userId!);
}
