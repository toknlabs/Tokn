import { cloneElement, type ReactElement, type ReactNode } from "react";

/** The pieces both Eaon pages are built from. */

export const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;

/** Change against an earlier figure, as "+12%"; null when there's nothing honest to compare. */
export function change(
  now: number,
  before: number | undefined | null,
): { text: string; up: boolean } | null {
  if (before === undefined || before === null || before <= 0 || now <= 0) return null;
  const delta = (now - before) / before;
  if (Math.abs(delta) < 0.005) return null;
  return { text: `${delta >= 0 ? "↑" : "↓"} ${Math.abs(delta * 100).toFixed(0)}%`, up: delta >= 0 };
}

/** One figure in a row of them: a small label, the value, an optional line under it. */
export function Stat({
  label,
  value,
  note,
  delta,
}: {
  label: string;
  value: ReactNode;
  note?: ReactNode;
  delta?: { text: string; up: boolean } | null;
}) {
  return (
    <div className="e-stat">
      <dt>{label}</dt>
      <dd>
        <span className="e-stat-value">{value}</span>
        {delta && (
          <span className="e-delta" data-up={delta.up}>
            {delta.text}
          </span>
        )}
      </dd>
      {note && <p className="e-stat-note">{note}</p>}
    </div>
  );
}

/** A titled block in "Under the hood". */
export function Card({
  title,
  note,
  children,
  wide,
}: {
  title: string;
  note?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className="e-card" data-wide={wide || undefined}>
      <header className="e-card-head">
        <h3>{title}</h3>
        {note && <span className="e-card-note">{note}</span>}
      </header>
      {children}
    </section>
  );
}

/**
 * Lays cards out two to a row: a wide card takes its own row, and a half-width
 * one left without a partner takes the row too, so no row is half empty.
 */
export function pairCards(cards: ReactElement<{ wide?: boolean }>[]): ReactNode[] {
  const out: ReactNode[] = [];
  let pending: ReactElement<{ wide?: boolean }> | null = null;
  for (const card of cards) {
    if (card.props.wide) {
      if (pending) out.push(cloneElement(pending, { wide: true }));
      pending = null;
      out.push(card);
    } else if (pending) {
      out.push(pending, card);
      pending = null;
    } else {
      pending = card;
    }
  }
  if (pending) out.push(cloneElement(pending, { wide: true }));
  return out;
}

/** Small label-and-value pairs at the foot of a card. */
export function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="e-facts">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}
