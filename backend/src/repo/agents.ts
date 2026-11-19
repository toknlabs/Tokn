import { db, DB_ID, Query, isNotFound } from "../client.ts";
import { agentRowId } from "../ids.ts";

/**
 * Agent runs, one row per (user, day, tool).
 *
 * Eaon Desktop knows something the CLI cannot: when an agent started, and how
 * long it ran. It sends a day's count and durations next to its usage rows, as
 * `agents` on POST /api/cli/sync. Like usage, the app re-sends its whole
 * history, so these rows **replace** rather than accumulate — the row id is a
 * pure function of (user, day, tool), and the same day always lands on the
 * same row.
 *
 * Nothing here is verifiable, any more than a token count is. The rules below
 * do not prove a number true; they refuse the ones that cannot be, so a broken
 * or hostile client cannot put a fourteen-year agent on a profile.
 */

export interface AgentRow {
  day: string;
  tool: string;
  runs: number;
  totalMs: number;
  longestMs: number;
}

export interface AgentDoc extends AgentRow {
  $id: string;
  userId: string;
  updatedAt: string;
}

export interface AgentRejection {
  day: string;
  tool: string;
  reason: string;
}

/** Entries in one upload. A year a day for a dozen tools fits many times over. */
export const MAX_AGENT_ENTRIES = 5_000;
/** Runs one person can start in a day. Over a run a second, around the clock. */
export const MAX_RUNS_PER_DAY = 100_000;
/** The longest single run worth believing. Anything past a week is a stuck clock. */
export const MAX_AGENT_MS = 7 * 86_400_000;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const BATCH = 100;
const READ_PAGE = 1000;

/**
 * One uploaded entry, or the reason it was refused.
 *
 * Small faults are clamped — a negative count becomes zero, a fractional one is
 * rounded — because they are what a sloppy client sends, not a dishonest one.
 * Values that cannot be true are refused outright: clamping a run of a year
 * down to a week would store a number the app never claimed.
 */
export function normalizeAgentRow(value: unknown, now = Date.now()): AgentRow | string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return "not-an-object";
  const entry = value as Record<string, unknown>;

  const day = typeof entry.day === "string" ? entry.day : "";
  if (!DAY_RE.test(day) || Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return "bad-day";
  // A day in the future means a skewed clock, not real work.
  if (day > new Date(now + 86_400_000).toISOString().slice(0, 10)) return "future-day";

  // Eaon Desktop is the only sender today; an entry without a tool is its.
  const tool =
    typeof entry.tool === "string" && entry.tool.trim().length > 0
      ? entry.tool.trim().toLowerCase().slice(0, 32)
      : "eaon";

  const int = (key: string): number | null => {
    const raw = entry[key] ?? 0;
    const parsed = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (!Number.isFinite(parsed)) return null;
    return Math.max(0, Math.round(parsed));
  };

  const runs = int("runs");
  let totalMs = int("totalMs");
  const longestMs = int("longestMs");
  if (runs === null || totalMs === null || longestMs === null) return "not-a-number";

  if (runs > MAX_RUNS_PER_DAY) return "too-many-runs";
  if (longestMs > MAX_AGENT_MS) return "run-too-long";
  // A day with no runs has no durations; a day with runs has at least the
  // longest one in its total.
  if (runs === 0 && (totalMs > 0 || longestMs > 0)) return "time-without-runs";
  if (totalMs < longestMs) totalMs = longestMs;
  if (totalMs > runs * MAX_AGENT_MS) return "total-too-long";

  return { day, tool, runs, totalMs, longestMs };
}

/**
 * Every uploaded entry, checked. A day sent twice keeps its last copy — the
 * same rule a re-sync follows, and a bulk write cannot carry two documents
 * with one id anyway.
 */
export function normalizeAgents(
  list: unknown[],
  now = Date.now(),
): { rows: AgentRow[]; rejected: AgentRejection[] } {
  const byKey = new Map<string, AgentRow>();
  const rejected: AgentRejection[] = [];

  for (const candidate of list) {
    const result = normalizeAgentRow(candidate, now);
    if (typeof result === "string") {
      const raw = (typeof candidate === "object" && candidate !== null ? candidate : {}) as Record<
        string,
        unknown
      >;
      rejected.push({
        day: typeof raw.day === "string" ? raw.day.slice(0, 10) : "",
        tool: typeof raw.tool === "string" ? raw.tool.slice(0, 32) : "",
        reason: result,
      });
      continue;
    }
    const key = `${result.day}|${result.tool}`;
    byKey.delete(key);
    byKey.set(key, result);
  }

  return { rows: [...byKey.values()], rejected };
}

/** The documents a set of rows is stored as. Pure, so the id rule is testable. */
export function agentDocuments(userId: string, rows: AgentRow[], now = new Date()): AgentDoc[] {
  const updatedAt = now.toISOString();
  return rows.map((row) => ({
    $id: agentRowId(userId, row.day, row.tool),
    userId,
    day: row.day,
    tool: row.tool,
    runs: row.runs,
    totalMs: row.totalMs,
    longestMs: row.longestMs,
    updatedAt,
  }));
}

/** Where documents go. Appwrite in production, a map in the tests. */
export type AgentWriter = (documents: AgentDoc[]) => Promise<void>;

const appwriteWriter: AgentWriter = async (documents) => {
  await db().upsertDocuments(DB_ID, "agent_daily", documents as never);
};

/** Store one user's agent days, replacing whatever those days held before. */
export async function upsertAgents(
  userId: string,
  rows: AgentRow[],
  write: AgentWriter = appwriteWriter,
  now = new Date(),
): Promise<number> {
  const documents = agentDocuments(userId, rows, now);
  for (let i = 0; i < documents.length; i += BATCH) {
    await write(documents.slice(i, i + BATCH));
  }
  return documents.length;
}

/**
 * Reads tolerate the collection not existing yet.
 *
 * `agent_daily` arrives with a provisioning run, and the code can deploy
 * before that run happens. A missing collection means nobody has any agent
 * runs, which is true, rather than a broken profile and a broken board.
 */
async function readAll(queries: string[]): Promise<AgentDoc[]> {
  const out: AgentDoc[] = [];
  let cursor: string | undefined;

  try {
    for (;;) {
      const page = await db().listDocuments(DB_ID, "agent_daily", [
        ...queries,
        Query.limit(READ_PAGE),
        Query.orderAsc("$id"),
        ...(cursor ? [Query.cursorAfter(cursor)] : []),
      ]);
      const docs = page.documents as unknown as AgentDoc[];
      out.push(...docs);
      if (docs.length < READ_PAGE) break;
      cursor = docs[docs.length - 1]?.$id;
      if (!cursor) break;
    }
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  return out;
}

/** One user's agent days, optionally for one tool. */
export async function listAgents(userId: string, options: { tool?: string } = {}): Promise<AgentDoc[]> {
  const queries = [Query.equal("userId", userId)];
  if (options.tool) queries.push(Query.equal("tool", options.tool));
  return readAll(queries);
}

/** Every agent day on the site. One row per person per active day, so small. */
export async function listAllAgents(options: { tool?: string } = {}): Promise<AgentDoc[]> {
  return readAll(options.tool ? [Query.equal("tool", options.tool)] : []);
}

export interface AgentSummary {
  runs: number;
  totalMs: number;
  longestMs: number;
  /** Days with at least one run. */
  activeDays: number;
  byDay: { day: string; runs: number; totalMs: number; longestMs: number }[];
}

/** Roll agent rows up, folding tools together per day. */
export function summarizeAgents(rows: Pick<AgentRow, "day" | "runs" | "totalMs" | "longestMs">[]): AgentSummary {
  const days = new Map<string, { day: string; runs: number; totalMs: number; longestMs: number }>();
  let runs = 0;
  let totalMs = 0;
  let longestMs = 0;

  for (const row of rows) {
    runs += row.runs;
    totalMs += row.totalMs;
    longestMs = Math.max(longestMs, row.longestMs);

    const day = days.get(row.day) ?? { day: row.day, runs: 0, totalMs: 0, longestMs: 0 };
    day.runs += row.runs;
    day.totalMs += row.totalMs;
    day.longestMs = Math.max(day.longestMs, row.longestMs);
    days.set(row.day, day);
  }

  const byDay = [...days.values()].sort((a, b) => a.day.localeCompare(b.day));
  return {
    runs,
    totalMs,
    longestMs,
    activeDays: byDay.filter((day) => day.runs > 0).length,
    byDay,
  };
}
