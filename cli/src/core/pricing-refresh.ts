import { ApiClient } from "./api.js";
import { saveConfig, type Config } from "./config.js";
import type { ModelPrice } from "./pricing.js";

/** How old the saved table may get before a local command asks for a new one. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Short on purpose: these commands are local, and must not hang on a slow network. */
const TIMEOUT_MS = 3_000;

/**
 * The server's price table for commands that do not upload: `tokn scan` and
 * the dashboard. Fetched again once the saved copy is a day old.
 *
 * Only `sync` used to fetch prices, so a machine that never synced, or was
 * never linked, priced against the table bundled with its CLI version. A
 * model released after that version showed with no cost. The pricing route
 * needs no token, so this works unlinked.
 *
 * Offline, or with the server down, it returns the saved table and the
 * bundled one still covers everything it knows.
 */
export async function currentPricing(config: Config): Promise<Record<string, ModelPrice> | undefined> {
  const saved = config.pricing;
  // An unreadable timestamp parses to NaN, which fails this test and refetches.
  if (saved && Date.now() - Date.parse(saved.fetchedAt) < MAX_AGE_MS) return saved.models;

  try {
    const { models } = await new ApiClient(config.host).pricing(TIMEOUT_MS);
    if (!models || Object.keys(models).length === 0) return saved?.models;
    await saveConfig({ ...config, pricing: { fetchedAt: new Date().toISOString(), models } });
    return models;
  } catch {
    return saved?.models;
  }
}
