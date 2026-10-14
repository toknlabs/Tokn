import "server-only";
import { headers } from "next/headers";

/**
 * The two hostnames this one deployment answers on.
 *
 *   toknhq.com      the site: every page, sign-in, the API
 *   tokns.eaon.dev  the Eaon Desktop board and profiles, nothing else
 *
 * `middleware.ts` decides which a request is for, by its host, and marks the
 * Eaon pages with `SITE_HEADER` as it rewrites them. Pages read that mark
 * here rather than looking at the host themselves, so the host rules live in
 * one place.
 */

export type Site = "tokn" | "eaon";

/** Must match `middleware.ts`, which cannot import server-only modules. */
export const SITE_HEADER = "x-tokn-site";

const trim = (url: string) => url.replace(/\/+$/, "");

/** The canonical site. Sign-in only ever happens here. */
export const TOKN_URL = trim(process.env.TOKN_PUBLIC_URL ?? "http://localhost:3000");

/** The Eaon host, for links and canonical URLs that point at it. */
export const EAON_URL = trim(process.env.TOKN_EAON_URL ?? "https://tokns.eaon.dev");

/** Which site the current request was served as. */
export async function currentSite(): Promise<Site> {
  return (await headers()).get(SITE_HEADER) === "eaon" ? "eaon" : "tokn";
}

/**
 * Where the Eaon pages are, as seen from the site serving them. On the Eaon
 * host they are `/` and `/@handle`; on toknhq.com the same pages sit at
 * `/eaon` and `/eaon/handle`.
 */
export function eaonPaths(site: Site): {
  board: string;
  profile: (handle: string) => string;
} {
  return site === "eaon"
    ? { board: "/", profile: (handle) => `/@${handle}` }
    : { board: "/eaon", profile: (handle) => `/eaon/${handle}` };
}

/** The canonical, absolute address of someone's Eaon profile. */
export function eaonProfileUrl(handle: string): string {
  return `${EAON_URL}/@${handle}`;
}

/** Someone's full profile, from either site. */
export function toknProfileHref(handle: string, site: Site): string {
  return site === "eaon" ? `${TOKN_URL}/profile/${handle}` : `/profile/${handle}`;
}
