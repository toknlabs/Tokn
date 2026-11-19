import { compact, shortDay } from "@/lib/format";

/**
 * The Eaon site's two charts, drawn on the server as plain HTML so the pages
 * need no script. Both are one colour (the text colour, at a few strengths);
 * hovering a bar or a square shows its numbers in the browser's own tooltip.
 */

/** The four kinds of token, in the order they are listed. */
export const KINDS = [
  { key: "cacheRead", label: "Cache read" },
  { key: "cacheWrite", label: "Cache write" },
  { key: "input", label: "Fresh input" },
  { key: "output", label: "Output" },
] as const;

export type KindKey = (typeof KINDS)[number]["key"];

/**
 * One bar per day under the big number. Bars rather than a line: with a few
 * active days a line draws spikes out of nothing, while bars just show the
 * days there were. Today is the solid one.
 */
export function DailyBars({
  days,
  height = 96,
  unit = "tokens",
  format = compact,
}: {
  days: { day: string; value: number }[];
  height?: number;
  unit?: string;
  format?: (value: number) => string;
}) {
  const max = Math.max(0, ...days.map((day) => day.value));
  return (
    <figure className="e-daily">
      <div className="e-daily-bars" style={{ height }} role="img" aria-label={`${unit} per day`}>
        {days.map((day, index) => (
          <span
            key={day.day}
            className="e-daily-bar"
            data-today={index === days.length - 1 || undefined}
            title={`${shortDay(day.day)}: ${format(day.value)} ${unit}`}
          >
            <i
              style={{
                height:
                  max > 0 ? `${Math.max(day.value > 0 ? 3 : 0, (day.value / max) * 100)}%` : 0,
              }}
            />
          </span>
        ))}
      </div>
      <figcaption className="e-daily-axis">
        <span>{days[0] ? shortDay(days[0].day) : ""}</span>
        <span>Today</span>
      </figcaption>
    </figure>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A year of days as squares: a column per week, Monday at the top. Shades are
 * quartiles of the person's own active days, so a light user's busy day is as
 * dark as a heavy one's.
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
          <span key={`m-${month.week}`} className="e-year-month" style={{ gridColumn: month.week + 1 }}>
            {month.label}
          </span>
        ))}
        {cells.map((cell) => (
          <span
            key={cell.day}
            className="e-year-cell"
            data-level={cell.future ? undefined : level(cell.value)}
            data-future={cell.future || undefined}
            style={{ gridColumn: cell.week + 1, gridRow: cell.weekday + 2 }}
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
