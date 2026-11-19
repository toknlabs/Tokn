import os from "node:os";
import type { SyncRow } from "./aggregate.js";
import type { ModelPrice } from "./pricing.js";
import type { BoardData, FriendsData, ProfileData, SiteData } from "../tui/types.js";
import { VERSION } from "../version.js";

/**
 * Dashboard API client.
 *
 * This file is the entire contract between the CLI and the website:
 *
 *   POST /api/cli/link     { code, device }        -> { token, user }
 *   GET  /api/cli/me       Bearer                  -> { user }
 *   POST /api/cli/sync     Bearer { rows, ... }    -> { accepted, rank?, profileUrl? }
 *   GET  /api/cli/pricing                          -> { models }
 *
 * and four more that exist only to render `tokn dashboard`, each mirroring one
 * page of the site. They are read-only by design — nothing a device token can
 * reach should be able to change an account.
 *
 *   GET  /api/cli/board    Bearer ?period&metric   -> the leaderboard
 *   GET  /api/cli/profile  Bearer ?handle          -> one profile
 *   GET  /api/cli/friends  Bearer ?window&metric   -> friends board + roster
 *   GET  /api/cli/site     Bearer                  -> site-wide stats
 *
 * Sync rows are an upsert keyed on (user, day, model, fast): re-running a full
 * scan must replace a day's figures, never add to them. That keeps the CLI
 * stateless and makes backfills and corrections self-healing.
 */

export interface User {
  id: string;
  handle: string;
  name?: string;
}

export interface LinkResponse {
  token: string;
  user: User;
}

export interface SyncResponse {
  accepted: number;
  skipped?: number;
  rank?: number;
  profileUrl?: string;
  /**
   * Rows the server would not store.
   *
   * The server recomputes every cost from token counts and its own price
   * table, and refuses rows that describe something a machine could not have
   * done. Worth showing rather than hiding: a row dropped for an unpriced
   * model is a real gap the user can report, and one dropped for an implausible
   * count means something is wrong with their logs.
   */
  rejected?: { day: string; model: string; reason: string; detail: string }[];
  /**
   * Models this upload brought that the server had no price for until it
   * checked models.dev during the sync. The table this CLI fetched before
   * uploading predates them, so it should fetch again.
   */
  newlyPriced?: string[];
  /**
   * The leaderboard's schedule. A sync is on your profile as soon as it is
   * stored, but the board refreshes on the hour, so the upload shows there at
   * `nextUpdateAt`. Absent from servers that predate the hourly board.
   */
  board?: { updatedAt: string; nextUpdateAt: string };
}

/** An error we can show the user as-is, without a stack trace. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly hint?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const TIMEOUT_MS = 30_000;

export class ApiClient {
  constructor(
    private readonly host: string,
    private readonly token?: string,
  ) {}

  private async request<T>(
    method: "GET" | "POST",
    endpoint: string,
    body?: unknown,
    auth = true,
    timeoutMs = TIMEOUT_MS,
  ): Promise<T> {
    const url = `${this.host.replace(/\/+$/, "")}${endpoint}`;

    const headers: Record<string, string> = {
      accept: "application/json",
      "user-agent": `tokn/${VERSION} (${process.platform}; node-${process.versions.node})`,
    };
    if (body !== undefined) headers["content-type"] = "application/json";
    if (auth && this.token) headers.authorization = `Bearer ${this.token}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ApiError(`request to ${this.host} timed out`);
      }
      throw new ApiError(
        `could not reach ${this.host}`,
        undefined,
        `${(error as Error).message}. Check your connection, or set TOKN_HOST if the dashboard lives elsewhere.`,
      );
    }

    // The timer deliberately stays armed past the headers. `fetch` resolves as
    // soon as they arrive, so clearing it here would leave a server that sends
    // headers and then stalls the body able to hang the CLI indefinitely —
    // no timeout, no error, no output. Both reads below are inside its reach.
    try {
      if (!response.ok) throw await this.toError(response);

      const text = await response.text();
      if (text.length === 0) return {} as T;
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new ApiError(
          `${this.host} returned a malformed response`,
          response.status,
          "Is TOKN_HOST pointing at the dashboard?",
        );
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ApiError(`request to ${this.host} timed out`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Turn an HTTP failure into something a person can act on. */
  private async toError(response: Response): Promise<ApiError> {
    let detail = "";
    try {
      const text = await response.text();
      const parsed = JSON.parse(text) as { error?: string; message?: string };
      detail = parsed.error ?? parsed.message ?? "";
    } catch {
      // Non-JSON body (an HTML error page, most likely).
    }

    switch (response.status) {
      case 400:
        return new ApiError(detail || "that code is not valid", 400);
      case 401:
        return new ApiError(
          detail || "this machine is no longer linked",
          401,
          "Run `tokn link` to reconnect.",
        );
      case 404:
        return new ApiError(
          detail || "that code has expired or was already used",
          404,
          "Generate a fresh code on your dashboard.",
        );
      case 429:
        return new ApiError(detail || "too many requests — try again shortly", 429);
      default:
        if (response.status >= 500) {
          return new ApiError(
            detail || "the dashboard is having trouble right now",
            response.status,
            "Your data is safe locally; try `tokn sync` again later.",
          );
        }
        return new ApiError(detail || `request failed (HTTP ${response.status})`, response.status);
    }
  }

  /** Exchange a dashboard-issued code for a long-lived device token. */
  link(code: string): Promise<LinkResponse> {
    return this.request<LinkResponse>(
      "POST",
      "/api/cli/link",
      {
        code,
        device: {
          hostname: os.hostname(),
          platform: process.platform,
          cliVersion: VERSION,
        },
      },
      false,
    );
  }

  me(): Promise<{ user: User }> {
    return this.request<{ user: User }>("GET", "/api/cli/me");
  }

  sync(payload: {
    rows: SyncRow[];
    timezone: string;
    scannedAt: string;
    cliVersion: string;
  }): Promise<SyncResponse> {
    return this.request<SyncResponse>("POST", "/api/cli/sync", payload);
  }

  /** `timeoutMs` for callers that would rather price from the saved table than wait. */
  pricing(timeoutMs?: number): Promise<{ models: Record<string, ModelPrice> }> {
    return this.request<{ models: Record<string, ModelPrice> }>(
      "GET",
      "/api/cli/pricing",
      undefined,
      false,
      timeoutMs,
    );
  }

  /* ----------------------------------------------- the terminal dashboard */

  /**
   * The four reads behind `tokn dashboard`.
   *
   * All GET, all authenticated with the device token. There is deliberately no
   * write here: the terminal dashboard shows the site, it does not edit it.
   */

  board(period: string, metric: string): Promise<BoardData> {
    return this.request<BoardData>(
      "GET",
      `/api/cli/board?period=${encodeURIComponent(period)}&metric=${encodeURIComponent(metric)}`,
    );
  }

  /** Omit the handle for your own profile. */
  profile(handle?: string): Promise<ProfileData> {
    const query = handle ? `?handle=${encodeURIComponent(handle)}` : "";
    return this.request<ProfileData>("GET", `/api/cli/profile${query}`);
  }

  friends(window: string, metric: string): Promise<FriendsData> {
    return this.request<FriendsData>(
      "GET",
      `/api/cli/friends?window=${encodeURIComponent(window)}&metric=${encodeURIComponent(metric)}`,
    );
  }

  site(): Promise<SiteData> {
    return this.request<SiteData>("GET", "/api/cli/site");
  }
}
