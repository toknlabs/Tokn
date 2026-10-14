import { compact, shortDay } from "@/lib/format";

/**
 * The Eaon site's charts: plain HTML and SVG drawn on the server, so the
 * pages need no script. Hovering a bar or a square shows its numbers in the
 * browser's own tooltip.
 */

/** The four kinds of token, in the order they stack. */
export const KINDS = [
  { key: "cacheRead", label: "Cache read", color: "var(--k-read)" },
  { key: "cacheWrite", label: "Cache write", color: "var(--k-write)" },
  { key: "input", label: "Fresh input", color: "var(--k-input)" },
  { key: "output", label: "Output", color: "var(--k-output)" },
] as const;

export type KindKey = (typeof KINDS)[number]["key"];

/**
 * One bar per day. Bars rather than a line: with a few active days a line
 * draws spikes out of nothing, while bars just show the days there were.
 */
export function DailyBars({
  days,
  height = 180,
  unit = "tokens",
  format = compact,
}: {
  days: { day: string; value: number }[];
  height?: number;
  unit?: string;
  format?: (value: number) => string;
}) {
  const max = Math.max(0, ...days.map((day) => day.value));
  const middle = days[Math.floor(days.length / 2)];
  return (
    <figure className="e-daily">
      <div className="e-daily-max" aria-hidden="true">
        {max > 0 ? format(max) : ""}
      </div>
      <div className="e-daily-bars" style={{ height }} role="img" aria-label={`${unit} per day`}>
        {days.map((day, index) => (
          <span
            key={day.day}
            className="e-daily-bar"
            data-today={index === days.length - 1 || undefined}
            data-empty={day.value <= 0 || undefined}
            title={`${shortDay(day.day)}: ${format(day.value)} ${unit}`}
          >
            <i
              style={{
                height:
                  max > 0 ? `${Math.max(day.value > 0 ? 2 : 0, (day.value / max) * 100)}%` : 0,
              }}
            />
          </span>
        ))}
      </div>
      <figcaption className="e-daily-axis">
        <span>{days[0] ? shortDay(days[0].day) : ""}</span>
        {days.length > 14 && middle && <span>{shortDay(middle.day)}</span>}
        <span>Today</span>
      </figcaption>
    </figure>
  );
}

/** Vertical bars for a few labelled values, such as the days of the week. */
export function Bars({
  values,
  labels,
  format = compact,
  unit = "",
}: {
  values: number[];
  labels: string[];
  format?: (value: number) => string;
  unit?: string;
}) {
  const max = Math.max(1, ...values);
  const peak = values.indexOf(Math.max(...values));
  return (
    <div className="e-bars">
      {values.map((value, index) => (
        <div
          key={labels[index] ?? index}
          className="e-bars-col"
          title={`${labels[index]}: ${format(value)}${unit}`}
        >
          <span className="e-bars-track">
            <i
              data-peak={index === peak && value > 0 ? true : undefined}
              style={{ height: `${(value / max) * 100}%` }}
            />
          </span>
          <span className="e-bars-label">{labels[index]}</span>
        </div>
      ))}
    </div>
  );
}

/** A ranked list with a share bar under each row. */
export function Ranked({
  items,
  format = compact,
}: {
  items: { label: string; value: number; sub?: string }[];
  format?: (value: number) => string;
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  return (
    <ol className="e-ranked">
      {items.map((item) => (
        <li key={item.label}>
          <div className="e-ranked-row">
            <span className="e-ranked-label">{item.label}</span>
            <span className="e-ranked-value">{format(item.value)}</span>
          </div>
          <span className="e-ranked-track">
            <i style={{ width: `${(item.value / total) * 100}%` }} />
          </span>
          {item.sub && <span className="e-ranked-sub">{item.sub}</span>}
        </li>
      ))}
    </ol>
  );
}

/** Tokens split by kind: one bar, and each kind's share under it. */
export function KindSplit({ kinds }: { kinds: Record<KindKey, number> }) {
  const total = KINDS.reduce((sum, kind) => sum + kinds[kind.key], 0);
  return (
    <div className="e-split">
      <div className="e-split-bar">
        {KINDS.map((kind) =>
          kinds[kind.key] > 0 ? (
            <span
              key={kind.key}
              style={{ flexGrow: kinds[kind.key], background: kind.color }}
              title={`${kind.label}: ${compact(kinds[kind.key])}`}
            />
          ) : null,
        )}
      </div>
      <dl className="e-split-legend">
        {KINDS.map((kind) => (
          <div key={kind.key}>
            <dt>
              <i style={{ background: kind.color }} />
              {kind.label}
            </dt>
            <dd>
              {compact(kinds[kind.key])}
              <span>{total > 0 ? `${((kinds[kind.key] / total) * 100).toFixed(1)}%` : ""}</span>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** A short line of the last few weeks, for a board row. */
export function Spark({ values, label }: { values: number[]; label: string }) {
  const width = 88;
  const height = 24;
  const max = Math.max(1, ...values);
  const points = values.map(
    (value, index) =>
      `${((index / Math.max(1, values.length - 1)) * width).toFixed(1)},${(height - 2 - (value / max) * (height - 4)).toFixed(1)}`,
  );
  return (
    <svg
      className="e-spark"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label={label}
    >
      <path d={`M${points.join(" L")}`} />
    </svg>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAY_LABELS = ["Mon", "", "Wed", "", "Fri", "", ""];

/**
 * A year of days as squares, like GitHub's: a column per week, Monday at the
 * top, the squares filling the width. Shades are quartiles of the person's
 * own active days, so a light user's busy day is as bright as a heavy one's.
 */
export function YearGrid({
  values,
  end,
  unit = "tokens",
}: {
  values: Map<string, number>;
  end: string;
  unit?: string;
}) {
  const endDate = new Date(`${end}T00:00:00Z`);
  const endWeekday = (endDate.getUTCDay() + 6) % 7;
  const start = new Date(endDate);
  start.setUTCDate(start.getUTCDate() - endWeekday - 52 * 7);

  const active = [...values.values()].filter((value) => value > 0).sort((a, b) => a - b);
  const q = (f: number) => active[Math.min(active.length - 1, Math.floor(f * active.length))] ?? 0;
  const cuts = [q(0.25), q(0.5), q(0.75)] as const;
  const level = (value: number) =>
    value <= 0 ? 0 : value <= cuts[0] ? 1 : value <= cuts[1] ? 2 : value <= cuts[2] ? 3 : 4;

  const cells: { day: string; value: number; week: number; weekday: number; future: boolean }[] =
    [];
  const months: { week: number; label: string }[] = [];
  const cursor = new Date(start);
  for (let week = 0; week < 53; week++) {
    for (let weekday = 0; weekday < 7; weekday++) {
      const day = cursor.toISOString().slice(0, 10);
      if (cursor.getUTCDate() <= 7 && weekday === 0)
        months.push({ week, label: MONTHS[cursor.getUTCMonth()] ?? "" });
      cells.push({ day, value: values.get(day) ?? 0, week, weekday, future: cursor > endDate });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  }

  return (
    <div className="e-year-scroll">
      <div className="e-year" role="img" aria-label={`${unit} per day over the last year`}>
        {months.map((month) => (
          <span
            key={`m-${month.week}`}
            className="e-year-month"
            style={{ gridColumn: month.week + 2 }}
          >
            {month.label}
          </span>
        ))}
        {DAY_LABELS.map((label, index) => (
          <span key={`d-${index}`} className="e-year-day" style={{ gridRow: index + 2 }}>
            {label}
          </span>
        ))}
        {cells.map((cell) => (
          <span
            key={cell.day}
            className="e-year-cell"
            data-level={cell.future ? undefined : level(cell.value)}
            data-future={cell.future || undefined}
            style={{ gridColumn: cell.week + 2, gridRow: cell.weekday + 2 }}
            title={
              cell.future
                ? undefined
                : `${shortDay(cell.day)}: ${cell.value > 0 ? `${compact(cell.value)} ${unit}` : "nothing"}`
            }
          />
        ))}
      </div>
    </div>
  );
}
