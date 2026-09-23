import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ModelPrice } from "./pricing.js";

/**
 * On-disk state: the link token, who it belongs to, and a cached pricing table.
 *
 * The file holds a credential, so it is written with mode 0600 inside a 0700
 * directory — the same posture `gh` uses for its hosts file.
 */

/**
 * Where the CLI talks to.
 *
 * `PRODUCTION_HOST` is the real origin, and a fresh install now uses it. It
 * deliberately stayed on localhost until the domain actually resolved and
 * served the app: a default pointing at dead DNS breaks every new install for
 * the sake of being early, and the failure looks like a broken CLI rather than
 * a missing deployment.
 *
 * Two escape hatches remain. Anyone already linked keeps the host stored in
 * their config until they re-link, so shipping this does not move existing
 * installs off whatever they were talking to. And `TOKN_HOST` overrides both,
 * which is how local development retargets a CLI built from this source:
 *
 *   TOKN_HOST=http://localhost:3000 tokn link
 */
export const PRODUCTION_HOST = "https://toknhq.com";
export const DEFAULT_HOST = PRODUCTION_HOST;

export interface Config {
  host: string;
  token?: string;
  user?: { id: string; handle: string; name?: string };
  linkedAt?: string;
  lastSyncAt?: string;
  lastSyncRows?: number;
  pricing?: { fetchedAt: string; models: Record<string, ModelPrice> };
  /** Background publishing driven by a Claude Code session hook. */
  autosync?: { enabled?: boolean; intervalMinutes?: number };
  /**
   * What the registry last said, so the check runs daily rather than hourly.
   * `declined` records a version the user turned down, which is not offered
   * again — being asked twice about the same release is nagging.
   */
  update?: { checkedAt?: string; latest?: string; declined?: string };
}

export function configDir(): string {
  return process.env.TOKN_CONFIG_DIR ?? path.join(os.homedir(), ".tokn");
}

export function configPath(): string {
  return path.join(configDir(), "config.json");
}

const DEFAULTS: Config = { host: DEFAULT_HOST };

export async function loadConfig(): Promise<Config> {
  try {
    const raw = await fs.readFile(configPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<Config>;
    return { ...DEFAULTS, ...parsed, host: resolveHost(parsed.host) };
  } catch {
    // Missing or corrupt: start from defaults rather than failing the command.
    return { ...DEFAULTS, host: resolveHost(undefined) };
  }
}

/** The host on disk, ignoring TOKN_HOST. */
async function storedHost(): Promise<string> {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath(), "utf8")) as Partial<Config>;
    return parsed.host ?? DEFAULT_HOST;
  } catch {
    return DEFAULT_HOST;
  }
}

/** Env var wins over the stored host so CI and local dev can retarget easily. */
function resolveHost(stored: string | undefined): string {
  return process.env.TOKN_HOST ?? stored ?? DEFAULT_HOST;
}

export async function saveConfig(config: Config): Promise<void> {
  const dir = configDir();
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  // `loadConfig` folds TOKN_HOST into `host`, and every command saves the
  // config it loaded. Writing that back would turn a one-off override into
  // the permanent host, so a single `TOKN_HOST=… tokn sync` left the CLI
  // pointed at a dev server. Keep whatever host was stored instead.
  const override = process.env.TOKN_HOST;
  const host = override && config.host === override ? await storedHost() : config.host;
  const body = JSON.stringify({ ...config, host }, null, 2) + "\n";
  await fs.writeFile(configPath(), body, { mode: 0o600 });
  // mkdir/writeFile only apply the mode on creation; enforce it every time in
  // case the file predates this logic or was copied in with looser bits.
  await fs.chmod(configPath(), 0o600).catch(() => {});
}

export async function clearConfig(): Promise<void> {
  const config = await loadConfig();
  await saveConfig({ host: config.host });
}

/** A token supplied by the environment overrides the stored one (for CI). */
export function resolveToken(config: Config): string | undefined {
  return process.env.TOKN_TOKEN ?? config.token;
}

export function isLinked(config: Config): boolean {
  return Boolean(resolveToken(config));
}
