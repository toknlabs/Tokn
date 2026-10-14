/**
 * Display helpers.
 *
 * Every number on this site is rendered through here so a token count reads the
 * same in a table cell, a tooltip and a chart axis.
 */

export function money(usd: number, precision?: 0 | 2): string {
  if (!Number.isFinite(usd)) return "$0.00";
  if (precision === 0) return `$${Math.round(usd).toLocaleString("en-US")}`;
  if (precision === 2) {
    return `$${usd.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  }
  if (usd >= 1000) return `$${Math.round(usd).toLocaleString("en-US")}`;
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  if (usd === 0) return "$0.00";
  return `$${usd.toFixed(3)}`;
}

const UNITS = [
  { at: 1e12, suffix: "T" },
  { at: 1e9, suffix: "B" },
  { at: 1e6, suffix: "M" },
  { at: 1e3, suffix: "K" },
];

export function compact(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const abs = Math.abs(value);
  for (const unit of UNITS) {
    if (abs >= unit.at) {
      const scaled = value / unit.at;
      // 9.4m reads better than 9m; 94m does not need the decimal.
      return `${scaled >= 100 ? Math.round(scaled) : scaled.toFixed(1)}${unit.suffix}`;
    }
  }
  return Math.round(value).toLocaleString("en-US");
}

export function count(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

export function percent(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `2026-09-18` -> `18 Sep 2026`. Parsed as UTC so the date never slips a day. */
export function niceDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** `2026-09-15` -> `Sep 15`, for chart axes where the year is understood. */
export function shortDay(day: string): string {
  const date = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return day;
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

/**
 * A run length, coarsely: `0m`, `47m`, `2h 5m`, `3d 4h`. Agents run for
 * minutes to hours, so seconds would be noise and a bare hour count would
 * hide most of the difference between two runs.
 */
export function duration(ms: number): string {
  const minutes = Math.max(0, Math.floor((Number.isFinite(ms) ? ms : 0) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return minutes % 60 === 0 ? `${hours}h` : `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days}d` : `${days}d ${hours % 24}h`;
}

export function niceDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function niceDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const mm = String(date.getUTCMinutes()).padStart(2, "0");
  return `${niceDate(iso)} ${hh}:${mm}`;
}

export function relative(iso: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "never";

  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 2_592_000) return `${Math.floor(seconds / 86_400)}d ago`;
  return niceDate(iso);
}

/**
 * How long ago a `YYYY-MM-DD` day was, in whole days. Days are the unit the
 * CLI reports in, so anything finer would be made up.
 */
export function sinceDay(day: string): string {
  const then = new Date(`${day}T00:00:00Z`).getTime();
  if (Number.isNaN(then)) return day;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const days = Math.round((today.getTime() - then) / 86_400_000);

  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return niceDay(day);
}

/** Seconds of wall-clock as `HH:MM:SS`, the way the profile header shows it. */
export function clock(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const hh = String(Math.floor(total / 3600)).padStart(2, "0");
  const mm = String(Math.floor((total % 3600) / 60)).padStart(2, "0");
  const ss = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}
