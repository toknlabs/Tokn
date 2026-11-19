import type { ReactNode } from "react";
import { Cells, type Cell } from "@/components/Cells";
import { ModelRing, type RingSlice } from "@/components/ModelRing";
import { PagedBars } from "@/components/PagedBars";
import { compact, count, money, percent } from "@/lib/format";

/**
 * The interchangeable renderers behind a profile section's "look".
 *
 * A look changes how figures are drawn, never which figures: every renderer
 * here takes the same rows its siblings do, so switching one in settings can
 * only change the shape on the page. Sections pick from these rather than each
 * growing its own variants, which keeps the eleven sections looking like one
 * site whichever looks their owner chose.
 */

/* --------------------------------------------------------------- figures */

/** A handful of labelled figures: cells, a key-value list, or tags. */
export function Figures({
  items,
  look,
}: {
  items: Cell[];
  look: "cells" | "list" | "tags";
}) {
  if (look === "list") {
    return (
      <dl className="kv">
        {items.map((item) => (
          <div key={item.k}>
            <dt>{item.k}</dt>
            <dd>
              <span className={item.idle ? "sub" : undefined}>{item.v}</span>
              {item.note && <span className="kv-note">{item.note}</span>}
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  if (look === "tags") {
    return (
      <ul className="figure-tags">
        {items.map((item) => (
          <li key={item.k} data-idle={item.idle ? "" : undefined} title={item.note}>
            <strong>{item.v}</strong> {item.k}
          </li>
        ))}
      </ul>
    );
  }

  return <Cells items={items} />;
}

/* --------------------------------------------------------------- columns */

/**
 * Labelled vertical columns scaled to the tallest, which alone takes the
 * accent. Used for the weekday split and the monthly totals.
 */
export function Columns({
  rows,
  format,
}: {
  rows: { label: string; value: number }[];
  format: (value: number) => string;
}) {
  const sum = rows.reduce((total, row) => total + row.value, 0);
  const max = Math.max(...rows.map((row) => row.value), 0) || 1;
  const top = rows.findIndex((row) => row.value === max);

  return (
    <div className="weekbars" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
      {rows.map((row, index) => (
        <div
          key={row.label}
          className="weekbar"
          data-top={index === top ? "" : undefined}
          title={`${row.label} ${format(row.value)}`}
        >
          <span className="pct">{sum > 0 ? percent(row.value, sum) : ""}</span>
          <span className="col">
            <span style={{ height: `${Math.max((row.value / max) * 100, 2)}%` }} />
          </span>
          <span className="day">{row.label}</span>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------- breakdown */

export interface BreakdownRow {
  key?: string;
  label: string;
  cost: number;
  tokens: number;
  requests: number;
  icon?: ReactNode;
}

/** Named ring slices before the rest fold into one; more stop being readable. */
const RING_NAMED = 5;
const RAMP = [100, 58, 38, 28, 22, 18] as const;
const shade = (index: number) =>
  index === 0
    ? "var(--main)"
    : `color-mix(in srgb, var(--main) ${RAMP[Math.min(index, RAMP.length - 1)]}%, var(--sub-alt))`;

/** Spend split by model or tool: share bars, a table, or a ring. */
export function Breakdown({
  rows,
  look,
  noun,
}: {
  rows: BreakdownRow[];
  look: "bars" | "table" | "ring";
  /** "model" or "tool", for the column heading and the folded slice. */
  noun: string;
}) {
  const totalCost = rows.reduce((sum, row) => sum + row.cost, 0);

  if (look === "table") {
    return (
      <div className="table-wrap">
        <table className="whatif">
          <thead>
            <tr>
              <th>{noun}</th>
              <th className="r">spend</th>
              <th className="r">share</th>
              <th className="r">tokens</th>
              <th className="r">requests</th>
              <th className="r">per request</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key ?? row.label}>
                <td>
                  {row.icon ? (
                    <span className="brand-item">
                      {row.icon}
                      <span className="brand-label">{row.label}</span>
                    </span>
                  ) : (
                    row.label
                  )}
                </td>
                <td className="r">{money(row.cost, 2)}</td>
                <td className="r sub">{percent(row.cost, totalCost)}</td>
                <td className="r sub">{compact(row.tokens)}</td>
                <td className="r sub">{count(row.requests)}</td>
                <td className="r sub">
                  {row.requests > 0 ? money(row.cost / row.requests) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (look === "ring" && totalCost > 0) {
    // By spend, like the bars and the table: on a profile the question is
    // where the money went. Past five slices the differences stop being
    // visible, so the tail folds into one labelled slice.
    const ranked = [...rows].sort((a, b) => b.cost - a.cost);
    const head = ranked.slice(0, RING_NAMED);
    const tail = ranked.slice(RING_NAMED);
    const slices: RingSlice[] = head.map((row, index) => ({
      key: row.key ?? row.label,
      label: row.label,
      share: row.cost / totalCost,
      tokens: row.tokens,
      cost: row.cost,
      costShare: row.cost / totalCost,
      requests: row.requests,
      users: null,
      models: 1,
      shade: shade(index),
      icon: row.icon,
    }));
    if (tail.length > 0) {
      const sum = (read: (row: BreakdownRow) => number) =>
        tail.reduce((total, row) => total + read(row), 0);
      slices.push({
        key: "other",
        label: `other · ${tail.length}`,
        share: sum((row) => row.cost) / totalCost,
        tokens: sum((row) => row.tokens),
        cost: sum((row) => row.cost),
        costShare: sum((row) => row.cost) / totalCost,
        requests: sum((row) => row.requests),
        users: null,
        models: tail.length,
        shade: shade(RING_NAMED),
      });
    }
    return <ModelRing slices={slices} noun={noun} />;
  }

  return (
    <PagedBars
      rows={rows.map((row) => ({
        key: row.key ?? row.label,
        label: row.label,
        value: row.cost,
        display: `${money(row.cost, 2)} · ${percent(row.cost, totalCost)}`,
        icon: row.icon,
      }))}
    />
  );
}

/* ------------------------------------------------------------- split bar */

/** Parts of one whole as a single bar, with the figures in a legend below. */
export function SplitBar({
  parts,
  format,
}: {
  parts: { label: string; value: number }[];
  format: (value: number) => string;
}) {
  const total = parts.reduce((sum, part) => sum + part.value, 0);
  if (total <= 0) return <p className="empty">no data yet</p>;

  return (
    <>
      <div className="split-bar">
        {parts.map((part, index) =>
          part.value / total > 0.001 ? (
            <span
              key={part.label}
              title={`${part.label} ${format(part.value)}`}
              style={{ width: `${(part.value / total) * 100}%`, background: shade(index) }}
            />
          ) : null,
        )}
      </div>
      <ul className="split-legend">
        {parts.map((part, index) => (
          <li key={part.label}>
            <span className="mix-dot" style={{ background: shade(index) }} />
            <span className="sub">{part.label}</span>
            <span>{format(part.value)}</span>
            <span className="sub">{percent(part.value, total)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
