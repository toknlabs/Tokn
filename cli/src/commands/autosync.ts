import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ApiClient } from "../core/api.js";
import { toSyncRows } from "../core/aggregate.js";
import { configDir, loadConfig, resolveToken, saveConfig, type Config } from "../core/config.js";
import { latestActivity } from "../core/sources/registry.js";
import { runScan } from "../core/run-scan.js";
import {
  DEFAULT_INTERVAL_MINUTES,
  DAILY_HOUR,
  DAILY_MINUTE,
  installScheduler,
  schedulerInstalled,
  schedulerKind,
  schedulerLoaded,
  uninstallScheduler,
} from "../core/scheduler.js";
import { bold, dim, green, gray, sym, yellow } from "../ui/ansi.js";
import { fullNumber, pluralize, relativeTime } from "../ui/format.js";
import { VERSION } from "../version.js";
import type { ParsedArgs } from "../args.js";

/**
 * `tokn autosync` — publish usage automatically from a Claude Code hook.
 *
 * Three rules govern everything here, because this runs unattended inside
 * someone else's session:
 *
 *   1. Never block. The hook is registered with `async: true`, so Claude Code
 *      does not wait for it, and we still keep the work small.
 *   2. Never speak. No stdout, no stderr. Results go to a log file.
 *   3. Never fail. Every path exits 0. A usage tracker must not be able to
 *      disrupt a coding session, whatever goes wrong.
 */

const LOCK_STALE_MS = 10 * 60_000;
const LOG_MAX_LINES = 100;

export async function autosyncCommand(args: ParsedArgs): Promise<number> {
  const sub = args.positionals[0];

  if (sub === "on" || sub === "install") return installHook(args);
  if (sub === "off" || sub === "uninstall") return uninstallHook();
  if (sub === "status") return autosyncStatus();

  // No subcommand: a hook or a scheduled job is firing.
  //
  // `--daily` is the 23:59 close. It ignores the throttle: a periodic run at
  // 23:30 would otherwise make it a no-op and the day would end on stale
  // figures.
  const force = args.flags.force === true || args.flags.daily === true;
  await runSilently(force, args.flags.daily === true);
  return 0;
}

// ---------------------------------------------------------------- the hook run

async function runSilently(force: boolean, daily = false): Promise<void> {
  try {
    const config = await loadConfig();
    const token = resolveToken(config);

    if (!token) return; // Not linked — nothing to do, and nothing to say.
    if (config.autosync?.enabled === false && !force) return;

    const interval = (config.autosync?.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES) * 60_000;
    if (!force && config.lastSyncAt) {
      const since = Date.now() - new Date(config.lastSyncAt).getTime();
      if (since >= 0 && since < interval) return; // Synced recently enough.
    }

    if (!(await acquireLock())) return; // Another session is already syncing.

    try {
      await syncOnce(config, token, force, daily);
    } finally {
      await releaseLock();
    }
  } catch (error) {
    // Swallow everything. A background tracker must never surface an error
    // into someone's session; the log is where this goes.
    await log(`error ${(error as Error)?.message ?? String(error)}`).catch(() => {});
  }
}

async function syncOnce(
  config: Config,
  token: string,
  force: boolean,
  daily = false,
): Promise<void> {
  // Cheap pre-check across every source: if nothing has been written since the
  // last sync, there is nothing new to report. Stat-only, so it costs
  // milliseconds and skips the expensive parse on most invocations.
  if (!force && config.lastSyncAt) {
    const lastSync = new Date(config.lastSyncAt).getTime();
    const newest = await latestActivity();
    if (newest > 0 && newest <= lastSync) {
      await log("skip no new activity");
      return;
    }
  }

  const client = new ApiClient(config.host, token);

  let pricing = config.pricing?.models;
  try {
    const fresh = await client.pricing();
    if (fresh.models && Object.keys(fresh.models).length > 0) pricing = fresh.models;
  } catch {
    // Offline or endpoint missing — the built-in catalog still prices correctly.
  }

  const result = await runScan({ pricing, quiet: true });
  const rows = toSyncRows(result.aggregation);
  if (rows.length === 0) return;

  const response = await client.sync({
    rows,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    scannedAt: new Date().toISOString(),
    cliVersion: VERSION,
  });

  // The server priced a model it met in this upload; the table fetched above
  // predates that. Saving it as is would leave `tokn scan` pricing that model
  // at nothing until the next sync.
  if (response.newlyPriced) {
    try {
      const fresh = await client.pricing();
      if (fresh.models && Object.keys(fresh.models).length > 0) pricing = fresh.models;
    } catch {
      // Keep the table we have; the next sync fetches again.
    }
  }

  await saveConfig({
    ...config,
    pricing: pricing ? { fetchedAt: new Date().toISOString(), models: pricing } : config.pricing,
    lastSyncAt: new Date().toISOString(),
    lastSyncRows: rows.length,
  });

  const tools = result.aggregation.byTool.length;
  await log(
    `sync ${daily ? "daily" : "ok"} rows=${rows.length} tools=${tools} requests=${result.aggregation.totals.requests} cost=${result.aggregation.totals.cost.total.toFixed(2)} accepted=${response.accepted}`,
  );
}

// ------------------------------------------------------------------- the lock

function lockPath(): string {
  return path.join(configDir(), "autosync.lock");
}

/**
 * Prevent two sessions from scanning at once — opening several terminals at
 * the same time should not mean several concurrent full scans.
 */
async function acquireLock(): Promise<boolean> {
  const file = lockPath();
  await fs.mkdir(configDir(), { recursive: true, mode: 0o700 });

  try {
    // `wx` fails if the file exists, which makes this atomic.
    await fs.writeFile(file, JSON.stringify({ pid: process.pid, at: Date.now() }), {
      flag: "wx",
      mode: 0o600,
    });
    return true;
  } catch {
    // Held — unless it was left behind by a process that died mid-scan.
    try {
      const raw = JSON.parse(await fs.readFile(file, "utf8")) as { at?: number };
      if (typeof raw.at === "number" && Date.now() - raw.at > LOCK_STALE_MS) {
        await fs.writeFile(file, JSON.stringify({ pid: process.pid, at: Date.now() }), {
          mode: 0o600,
        });
        return true;
      }
    } catch {
      // Unreadable lock: treat as held rather than risk a stampede.
    }
    return false;
  }
}

async function releaseLock(): Promise<void> {
  await fs.rm(lockPath(), { force: true }).catch(() => {});
}

// -------------------------------------------------------------------- the log

function logPath(): string {
  return path.join(configDir(), "autosync.log");
}

async function log(line: string): Promise<void> {
  const entry = `${new Date().toISOString()} ${line}\n`;
  const file = logPath();
  await fs.mkdir(configDir(), { recursive: true, mode: 0o700 });

  let existing = "";
  try {
    existing = await fs.readFile(file, "utf8");
  } catch {
    // First write.
  }

  // Keep the log bounded; this file is a debugging aid, not a record.
  const lines = (existing + entry).split("\n").filter(Boolean);
  const trimmed = lines.slice(-LOG_MAX_LINES).join("\n") + "\n";
  await fs.writeFile(file, trimmed, { mode: 0o600 });
}

// ------------------------------------------------------- hook install / remove

/** Claude Code's user-level settings file. */
function claudeSettingsPath(): string {
  const base = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), ".claude");
  return path.join(base, "settings.json");
}

const HOOK_EVENTS = ["SessionStart", "SessionEnd"] as const;
const HOOK_COMMAND = "tokn autosync";

interface HookEntry {
  type?: string;
  command?: string;
  async?: boolean;
  timeout?: number;
  [key: string]: unknown;
}
interface HookGroup {
  matcher?: string;
  hooks?: HookEntry[];
  [key: string]: unknown;
}

function isOurs(entry: HookEntry): boolean {
  return typeof entry.command === "string" && entry.command.includes(HOOK_COMMAND);
}

async function readSettings(): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(claudeSettingsPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error("settings.json is not a JSON object");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    // Refuse to touch a file we cannot parse — overwriting it would silently
    // disable every setting the user has.
    throw new Error(
      `could not read ${claudeSettingsPath()}: ${(error as Error).message}`,
    );
  }
}

/**
 * Write settings atomically: a partial write here would break every Claude Code
 * setting the user has, not just ours.
 */
async function writeSettings(settings: Record<string, unknown>): Promise<void> {
  const file = claudeSettingsPath();
  const tmp = `${file}.tokn-${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(settings, null, 2) + "\n", "utf8");
  await fs.rename(tmp, file);
}

async function installHook(args: ParsedArgs): Promise<number> {
  const out = process.stdout;
  const config = await loadConfig();

  let settings: Record<string, unknown>;
  try {
    settings = await readSettings();
  } catch (error) {
    out.write(`\n  ${yellow(sym.cross)} ${(error as Error).message}\n`);
    out.write(`  ${dim("Fix that file first — tokn will not overwrite it.")}\n\n`);
    return 1;
  }

  const hooks = (settings.hooks ?? {}) as Record<string, HookGroup[]>;
  let added = 0;

  for (const event of HOOK_EVENTS) {
    const groups = Array.isArray(hooks[event]) ? [...(hooks[event] as HookGroup[])] : [];

    // Idempotent: re-running should not stack duplicate hooks.
    const already = groups.some((group) => (group.hooks ?? []).some(isOurs));
    if (already) continue;

    groups.push({
      hooks: [
        {
          type: "command",
          command: HOOK_COMMAND,
          // The hook must not delay the session; Claude Code runs it detached.
          async: true,
          timeout: 300,
        },
      ],
    });
    hooks[event] = groups;
    added++;
  }

  settings.hooks = hooks;
  await writeSettings(settings);

  // `--every <minutes>` overrides, and is remembered. Clamped to a range that
  // keeps the job cheap for the machine and the numbers fresh on the board.
  const requested = typeof args.flags.every === "string" ? Number(args.flags.every) : NaN;
  const interval = Number.isFinite(requested)
    ? Math.min(Math.max(Math.round(requested), 15), 24 * 60)
    : (config.autosync?.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES);


  await saveConfig({
    ...config,
    autosync: { enabled: true, intervalMinutes: interval },
  });

  // The hook alone only covers Claude Code. The OS scheduler is what makes
  // this work for Claude Desktop, Codex, Copilot and opencode, and what lets
  // the day close at a fixed time whether or not anyone starts a session.
  //
  // `--no-schedule` installs the hook alone, for people who would rather not
  // have a background job at all.
  const wantsSchedule = args.flags.schedule !== false;
  if (!wantsSchedule) await uninstallScheduler();
  const scheduler = wantsSchedule
    ? await installScheduler(interval)
    : { kind: schedulerKind(), installed: false, intervalMinutes: interval, watching: 0 };

  out.write(
    added > 0 || scheduler.installed
      ? `\n  ${green(sym.tick)} Auto-sync enabled\n\n`
      : `\n  ${green(sym.tick)} Auto-sync was already enabled\n\n`,
  );

  const clock = `${String(DAILY_HOUR).padStart(2, "0")}:${String(DAILY_MINUTE).padStart(2, "0")}`;

  if (scheduler.installed) {
    out.write(`  ${dim(`Every ${interval} minutes, in the background.`)}\n`);
    out.write(`  ${dim(`Again at ${clock} to close out the day.`)}\n`);
    if (scheduler.watching > 0) {
      out.write(
        `  ${dim(`Also when any of ${scheduler.watching} session stores change, so a`)}\n`,
      );
      out.write(`  ${dim("new session publishes promptly rather than waiting.")}\n`);
    }
    out.write(`\n  ${dim("Scheduled job:")} ${gray(scheduler.detail ?? scheduler.kind)}\n`);
  } else {
    out.write(
      `  ${yellow(sym.bullet)} ${dim(`No background scheduler on this platform (${process.platform}).`)}\n`,
    );
    out.write(`  ${dim("Syncs still run when a Claude Code session starts or ends.")}\n`);
  }

  out.write(`  ${dim("Claude Code hook:")} ${gray(tildify(claudeSettingsPath()))}\n`);
  out.write(`  ${dim("Turn it off with")} ${bold("tokn autosync off")}\n\n`);

  if (!resolveToken(config)) {
    out.write(
      `  ${yellow(sym.bullet)} ${dim("Not linked yet — auto-sync stays idle until you run")} ${bold("tokn link")}${dim(".")}\n\n`,
    );
  }

  return 0;
}

async function uninstallHook(): Promise<number> {
  const out = process.stdout;
  const config = await loadConfig();

  let settings: Record<string, unknown>;
  try {
    settings = await readSettings();
  } catch (error) {
    out.write(`\n  ${yellow(sym.cross)} ${(error as Error).message}\n\n`);
    return 1;
  }

  const hooks = (settings.hooks ?? {}) as Record<string, HookGroup[]>;
  let removed = 0;

  for (const event of HOOK_EVENTS) {
    const groups = hooks[event];
    if (!Array.isArray(groups)) continue;

    const kept: HookGroup[] = [];
    for (const group of groups) {
      const entries = (group.hooks ?? []).filter((entry) => {
        if (isOurs(entry)) {
          removed++;
          return false;
        }
        return true;
      });
      // Drop a group only if it is now empty and we are what emptied it.
      if (entries.length > 0) kept.push({ ...group, hooks: entries });
    }

    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
  }

  if (Object.keys(hooks).length > 0) settings.hooks = hooks;
  else delete settings.hooks;

  await writeSettings(settings);
  const jobs = await uninstallScheduler();

  await saveConfig({
    ...config,
    autosync: { ...config.autosync, enabled: false },
  });

  out.write(
    removed > 0 || jobs > 0
      ? `\n  ${green(sym.tick)} Auto-sync disabled\n\n`
      : `\n  ${dim("Auto-sync was not enabled.")}\n\n`,
  );
  if (jobs > 0) {
    out.write(`  ${dim(`Removed ${jobs} scheduled ${jobs === 1 ? "job" : "jobs"}.`)}\n\n`);
  }
  return 0;
}

async function autosyncStatus(): Promise<number> {
  const out = process.stdout;
  const config = await loadConfig();

  let installed = false;
  try {
    const settings = await readSettings();
    const hooks = (settings.hooks ?? {}) as Record<string, HookGroup[]>;
    installed = HOOK_EVENTS.some((event) =>
      (hooks[event] ?? []).some((group) => (group.hooks ?? []).some(isOurs)),
    );
  } catch {
    // Unreadable settings — report as not installed rather than guessing.
  }

  const interval = config.autosync?.intervalMinutes ?? DEFAULT_INTERVAL_MINUTES;
  const scheduled = await schedulerInstalled();
  const loaded = scheduled ? await schedulerLoaded() : false;
  const enabled = (installed || scheduled) && config.autosync?.enabled !== false;

  const clock = `${String(DAILY_HOUR).padStart(2, "0")}:${String(DAILY_MINUTE).padStart(2, "0")}`;

  out.write(`\n  ${bold("Auto-sync")}\n`);
  out.write(
    enabled
      ? `    ${green(sym.tick)} On\n`
      : `    ${yellow(sym.cross)} Off ${dim("— enable with")} ${bold("tokn autosync on")}\n`,
  );

  if (enabled) {
    // Three triggers, listed separately because they fail independently: the
    // hook can be present while the scheduled job is not, and vice versa.
    out.write(
      scheduled
        ? `    ${green(sym.tick)} Every ${interval}m ${dim(loaded ? `(${schedulerKind()}, running)` : `(${schedulerKind()}, not loaded — log out and back in)`)}\n`
        : `    ${yellow(sym.cross)} ${dim("No background schedule")}\n`,
    );
    out.write(
      scheduled
        ? `    ${green(sym.tick)} Daily close at ${clock}\n`
        : `    ${yellow(sym.cross)} ${dim("No daily close")}\n`,
    );
    out.write(
      installed
        ? `    ${green(sym.tick)} ${dim("On Claude Code session start and end")}\n`
        : `    ${yellow(sym.cross)} ${dim("Claude Code hook not installed")}\n`,
    );
  }

  if (config.lastSyncAt) {
    const rows = config.lastSyncRows;
    const detail = rows ? ` ${dim(`(${fullNumber(rows)} ${pluralize(rows, "row")})`)}` : "";
    out.write(`    ${dim("Last sync:")} ${relativeTime(config.lastSyncAt)}${detail}\n`);
  } else {
    out.write(`    ${dim("Last sync:")} never\n`);
  }

  const recent = await tailLog(5);
  if (recent.length > 0) {
    out.write(`\n  ${dim("Recent activity")}\n`);
    for (const line of recent) out.write(`    ${dim(line)}\n`);
  }

  out.write("\n");
  return 0;
}

async function tailLog(n: number): Promise<string[]> {
  try {
    const raw = await fs.readFile(logPath(), "utf8");
    return raw.split("\n").filter(Boolean).slice(-n);
  } catch {
    return [];
  }
}

function tildify(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? path.join("~", p.slice(home.length)) : p;
}
