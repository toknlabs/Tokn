import type { ReactNode } from "react";

/** The pieces both Eaon pages are built from. */

export const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;

/** Change against an earlier figure, as "↑ 12%"; null when there's nothing honest to compare. */
export function change(
  now: number,
  before: number | undefined | null,
): { text: string; up: boolean } | null {
  if (before === undefined || before === null || before <= 0 || now <= 0) return null;
  const delta = (now - before) / before;
  if (Math.abs(delta) < 0.005) return null;
  return { text: `${delta >= 0 ? "↑" : "↓"} ${Math.abs(delta * 100).toFixed(0)}%`, up: delta >= 0 };
}

/** One row of a list: what it is on the left, the figure on the right, and an optional line under it. */
export type Row = { label: ReactNode; value: ReactNode; sub?: ReactNode; key?: string };

/**
 * A titled group of rows, separated by hairlines. Everything under the board
 * is one of these: a number and what it means, no boxes, no colour.
 */
export function Group({ title, note, rows }: { title: string; note?: ReactNode; rows: Row[] }) {
  if (rows.length === 0) return null;
  return (
    <section className="e-group">
      <header className="e-group-head">
        <h3>{title}</h3>
        {note && <span>{note}</span>}
      </header>
      <dl className="e-list">
        {rows.map((row, index) => (
          <div key={row.key ?? (typeof row.label === "string" ? row.label : index)}>
            <dt>
              {row.label}
              {row.sub && <span>{row.sub}</span>}
            </dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
