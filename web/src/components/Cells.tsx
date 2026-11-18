/**
 * A row of secondary figures: a label, the figure, and at most one short note.
 *
 * The headline row's layout at a smaller size. Profile sections that used to
 * explain a number in a paragraph state it here instead, and the note carries
 * only what the figure cannot: a date, a comparison, a direction.
 */

export interface Cell {
  k: string;
  v: string;
  note?: string;
  /** Drawn quiet, for a figure there is nothing behind yet. */
  idle?: boolean;
}

export function Cells({ items }: { items: Cell[] }) {
  return (
    <div className="cells">
      {items.map((item) => (
        <div key={item.k} className="cell">
          <span className="k">{item.k}</span>
          <span className={`v${item.idle ? " idle" : ""}`}>{item.v}</span>
          {item.note && <span className="n">{item.note}</span>}
        </div>
      ))}
    </div>
  );
}
