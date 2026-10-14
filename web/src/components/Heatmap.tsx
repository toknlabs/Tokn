import { money, niceDay } from "@/lib/format";
import { toDay } from "@/lib/stats";

/**
 * A year of activity as a grid of squares, like GitHub's: one column per
 * week, Sunday at the top, month initials along the header, and the squares
 * sized to fill the width they are given.
 *
 * Intensity is ranked rather than linear. A single $40 day would otherwise
 * flatten every other dot to the faintest shade, so the four shades are
 * quartiles of the days that had any usage at all.
 */

export interface HeatmapDay {
  day: string;
  cost: number;
  requests: number;
}

const MONTHS = "JFMAMJJASOND";
const DAY_LABELS = ["", "M", "", "W", "", "F", ""];

export function Heatmap({ days, weeks = 53 }: { days: HeatmapDay[]; weeks?: number }) {
  const byDay = new Map(days.map((entry) => [entry.day, entry]));

  // Wind back to the Sunday that starts the window so the columns line up.
  const end = new Date();
  end.setUTCHours(0, 0, 0, 0);
  const cursor = new Date(end);
  cursor.setUTCDate(cursor.getUTCDate() - (weeks * 7 - 1));
  cursor.setUTCDate(cursor.getUTCDate() - cursor.getUTCDay());

  const thresholds = quartiles(days.map((entry) => entry.cost).filter((cost) => cost > 0));

  const columns: { key: string; month: number; cells: { day: string; future: boolean }[] }[] = [];

  while (cursor <= end) {
    const key = toDay(cursor);
    const month = cursor.getUTCMonth();
    const cells: { day: string; future: boolean }[] = [];

    for (let weekday = 0; weekday < 7; weekday++) {
      cells.push({ day: toDay(cursor), future: cursor > end });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    columns.push({ key, month, cells });
  }

  // One grid: the weekday labels in the first column, then a column per
  // week that shares the width evenly, so the squares grow to fill the page
  // and the months line up with the weeks they start in.
  return (
    <div className="scroll-x">
      <div
        className="heat"
        style={{ "--weeks": columns.length, minWidth: columns.length * 10 + 24 } as React.CSSProperties}
      >
        {columns.map((column, index) =>
          index === 0 || columns[index - 1]!.month !== column.month ? (
            <span key={`m-${column.key}`} className="heat-month" style={{ gridColumn: index + 2 }}>
              {MONTHS[column.month]}
            </span>
          ) : null,
        )}

        {DAY_LABELS.map((label, index) => (
          <span key={`d-${index}`} className="heat-day" style={{ gridRow: index + 2 }}>
            {label}
          </span>
        ))}

        {columns.map((column, week) =>
          column.cells.map((cell, weekday) => {
            const entry = byDay.get(cell.day);
            const level = cell.future ? 0 : levelFor(entry?.cost ?? 0, thresholds);
            return (
              <span
                key={cell.day}
                className="dot"
                data-level={level}
                style={{ gridColumn: week + 2, gridRow: weekday + 2, ...(cell.future ? { opacity: 0.4 } : {}) }}
                title={
                  entry
                    ? `${niceDay(cell.day)} · ${money(entry.cost)} · ${entry.requests} requests`
                    : `${niceDay(cell.day)} · no usage`
                }
              />
            );
          }),
        )}
      </div>
    </div>
  );
}

function quartiles(values: number[]): [number, number, number] {
  if (values.length === 0) return [0, 0, 0];
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
  return [at(0.25), at(0.5), at(0.75)];
}

function levelFor(cost: number, [q1, q2, q3]: [number, number, number]): 0 | 1 | 2 | 3 | 4 {
  if (cost <= 0) return 0;
  if (cost > q3) return 4;
  if (cost > q2) return 3;
  if (cost > q1) return 2;
  return 1;
}
