/** The small pieces both Eaon pages are built from: a stat tile, a panel heading, a labelled fact. */

export type Delta = { text: string; up: boolean | "flat" } | null;

/** Change against an earlier figure, as "+12.4%"; null when there's nothing to compare. */
export function change(now: number, before: number | undefined | null): Delta {
  if (before === undefined || before === null || before <= 0) return null;
  const delta = (now - before) / before;
  if (Math.abs(delta) < 0.0005) return { text: "±0%", up: "flat" };
  return { text: `${delta >= 0 ? "+" : "−"}${Math.abs(delta * 100).toFixed(1)}%`, up: delta >= 0 };
}

export const pct = (value: number, digits = 1) => `${(value * 100).toFixed(digits)}%`;

/** A stat with its name in code style above it (`cache.hit_rate`), and a line of context under it. */
export function Kpi({ k, v, foot, delta }: { k: string; v: string; foot?: string; delta?: Delta }) {
  return (
    <div className="e-kpi">
      <span className="e-k">{k}</span>
      <span className="e-kpi-v">{v}</span>
      <span className="e-kpi-foot">
        {delta && (
          <span className="e-delta" data-up={delta.up}>
            {delta.text}
          </span>
        )}
        {foot}
      </span>
    </div>
  );
}

export function PanelHead({ k, title, note, small }: { k: string; title: string; note?: string; small?: boolean }) {
  return (
    <div className="e-panel-head" data-small={small || undefined}>
      <div>
        <span className="e-k">{k}</span>
        <h3>{title}</h3>
      </div>
      {note && <span className="e-panel-note">{note}</span>}
    </div>
  );
}

export function Fact({ k, v, title }: { k: string; v: string; title?: string }) {
  return (
    <div className="e-fact" title={title}>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
