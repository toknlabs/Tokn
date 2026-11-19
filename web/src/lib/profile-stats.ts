import type { DayPoint } from "@/lib/stats";

/**
 * Figures a profile derives from its own day series.
 *
 * Pure, and kept apart from `stats.ts` so they can be checked without a
 * database: everything here is arithmetic over `byDay`, which the profile has
 * already loaded.
 *
 * `byDay` holds only days with usage. Every window here is cut by date, never
 * by counting entries, or a twice-a-week account's "last 7 days" would reach
 * back a month.
 */

export interface Window {
  /** Spend inside the window. */
  cost: number;
  /** Spend in the same length of time just before it. */
  previous: number;
  /** Percent change against `previous`; null when there is nothing to compare. */
  change: number | null;
}

/** Spend over the last `days` days ending `until`, against the `days` before. */
export function window(
  byDay: DayPoint[],
  days: number,
  until = today(),
): Window {
  const from = shiftDay(until, -(days - 1));
  const before = shiftDay(from, -days);

  let cost = 0;
  let previous = 0;
  for (const point of byDay) {
    if (point.day > until) continue;
    if (point.day >= from) cost += point.cost;
    else if (point.day >= before) previous += point.cost;
  }

  return {
    cost,
    previous,
    // A week from nothing is not "+∞%"; it is a first week.
    change: previous > 0 ? ((cost - previous) / previous) * 100 : null,
  };
}

export interface Peak {
  value: number;
  /** The day it happened, or the first day of the week it happened in. */
  day: string;
}

export interface Peaks {
  cost: Peak | null;
  tokens: Peak | null;
  requests: Peak | null;
  /** Best Monday-to-Sunday week by spend. */
  week: Peak | null;
}

export function peaks(byDay: DayPoint[]): Peaks {
  const top = (pick: (point: DayPoint) => number): Peak | null =>
    byDay.reduce<Peak | null>((best, point) => {
      const value = pick(point);
      return value > 0 && (best === null || value > best.value)
        ? { value, day: point.day }
        : best;
    }, null);

  const weeks = new Map<string, number>();
  for (const point of byDay) {
    const start = mondayOf(point.day);
    weeks.set(start, (weeks.get(start) ?? 0) + point.cost);
  }
  let week: Peak | null = null;
  for (const [day, value] of weeks) {
    if (value > 0 && (week === null || value > week.value)) week = { value, day };
  }

  return {
    cost: top((point) => point.cost),
    tokens: top((point) => point.tokens),
    requests: top((point) => point.requests),
    week,
  };
}

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/** Spend per weekday, Monday first. Days are UTC, as the CLI uploads them. */
export function byWeekday(byDay: DayPoint[]): number[] {
  const totals = new Array<number>(7).fill(0);
  for (const point of byDay) {
    totals[weekdayIndex(point.day)]! += point.cost;
  }
  return totals;
}

/**
 * Days with usage out of the days since the first one, today included.
 * Null with no usage at all.
 */
export function activeShare(
  byDay: DayPoint[],
  until = today(),
): { active: number; span: number } | null {
  const first = byDay[0]?.day;
  if (!first) return null;

  const span =
    Math.round(
      (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) /
        86_400_000,
    ) + 1;
  return { active: byDay.length, span: Math.max(span, byDay.length) };
}

/**
 * Cached tokens as a share of everything sent in.
 *
 * Output is left out: it is never cached, so counting it would make a
 * chatty session look like a cold one.
 */
export function cacheHitRate(tokens: {
  input: number;
  cacheRead: number;
  cacheWrite: number;
}): number | null {
  const sent = tokens.input + tokens.cacheRead + tokens.cacheWrite;
  return sent > 0 ? tokens.cacheRead / sent : null;
}

/* ---------------------------------------------------------------- dates */

// Copies of the two in `stats.ts`, which cannot be imported here without
// pulling the database client in with them.
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** 0 for Monday through 6 for Sunday. */
function weekdayIndex(day: string): number {
  return (new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7;
}

function mondayOf(day: string): string {
  return shiftDay(day, -weekdayIndex(day));
}
