import { compact, shortDay } from "@/lib/format";

/**
 * The Eaon site's charts: plain SVG drawn on the server, so the pages need no
 * script to show them. Hovering a bar or a point shows its value through the
 * browser's own tooltip (`<title>`).
 *
 * Colours come from CSS variables in eaon.css (`--k-input` and the rest), so
 * a chart and its legend can't disagree.
 */

/** The four kinds of token, in the order they stack, bottom up. */
export const KINDS = [
  { key: "cacheRead", label: "cache read", color: "var(--k-read)" },
  { key: "cacheWrite", label: "cache write", color: "var(--k-write)" },
  { key: "input", label: "input", color: "var(--k-input)" },
  { key: "output", label: "output", color: "var(--k-output)" },
] as const;

export type KindKey = (typeof KINDS)[number]["key"];

/** A round number at or above `value`, for an axis that ends on something readable. */
function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (step * magnitude >= value) return step * magnitude;
  return 10 * magnitude;
}

/**
 * Tokens per day, stacked by kind, with a light grid and the axis on the
 * right. `days` is dense: one entry per calendar day.
 */
export function StackedArea({
  days,
  height = 240,
}: {
  days: ({ day: string } & Record<KindKey, number>)[];
  height?: number;
}) {
  const width = 1000;
  const pad = { top: 10, right: 56, bottom: 26, left: 0 };
  const inner = { w: width - pad.left - pad.right, h: height - pad.top - pad.bottom };
  const totals = days.map((day) => KINDS.reduce((sum, kind) => sum + day[kind.key], 0));
  const max = niceCeil(Math.max(1, ...totals));
  const x = (index: number) => pad.left + (days.length <= 1 ? inner.w / 2 : (index / (days.length - 1)) * inner.w);
  const y = (value: number) => pad.top + inner.h - (value / max) * inner.h;

  // Each layer is the area between the running total below it and the one with it added.
  const below = new Array<number>(days.length).fill(0);
  const layers = KINDS.map((kind) => {
    const bottom = [...below];
    days.forEach((day, index) => (below[index] = (below[index] ?? 0) + day[kind.key]));
    const top = [...below];
    const upper = top.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`);
    const lower = bottom.map((value, index) => `${x(index).toFixed(1)},${y(value).toFixed(1)}`).reverse();
    return { kind, d: `M${upper.join("L")}L${lower.join("L")}Z`, line: `M${upper.join("L")}` };
  });

  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
  const labelEvery = Math.max(1, Math.ceil(days.length / 6));

  return (
    <svg className="e-chart" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="tokens per day by kind">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={pad.left} x2={pad.left + inner.w} y1={y(tick)} y2={y(tick)} className="e-gridline" />
          <text x={width - 4} y={y(tick) + 4} className="e-axis" textAnchor="end">
            {compact(tick)}
          </text>
        </g>
      ))}
      {layers.map((layer) => (
        <g key={layer.kind.key}>
          <path d={layer.d} fill={layer.kind.color} className="e-layer" />
          <path d={layer.line} stroke={layer.kind.color} className="e-layer-line" />
        </g>
      ))}
      {days.map((day, index) =>
        index % labelEvery === 0 || index === days.length - 1 ? (
          <text key={day.day} x={x(index)} y={height - 6} className="e-axis" textAnchor={index === 0 ? "start" : index === days.length - 1 ? "end" : "middle"}>
            {index === days.length - 1 ? "today" : shortDay(day.day)}
          </text>
        ) : null,
      )}
      {/* Wide invisible columns carry each day's numbers to the tooltip. */}
      {days.map((day, index) => {
        const w = inner.w / Math.max(1, days.length);
        return (
          <rect key={`hit-${day.day}`} x={x(index) - w / 2} y={pad.top} width={w} height={inner.h} className="e-hit">
            <title>
              {`${shortDay(day.day)} · ${compact(totals[index] ?? 0)} tokens\n` +
                KINDS.map((kind) => `${kind.label}: ${compact(day[kind.key])}`).join("\n")}
            </title>
          </rect>
        );
      })}
    </svg>
  );
}

/** Vertical bars, one per label, the largest marked. */
export function Bars({
  values,
  labels,
  height = 120,
  format = compact,
  unit = "",
  className,
}: {
  values: number[];
  labels: string[];
  height?: number;
  format?: (value: number) => string;
  unit?: string;
  className?: string;
}) {
  const max = Math.max(1, ...values);
  const peak = values.indexOf(Math.max(...values));
  return (
    <div className={`e-bars ${className ?? ""}`} style={{ height }}>
      {values.map((value, index) => (
        <div key={labels[index] ?? index} className="e-bar" data-peak={index === peak && value > 0 ? true : undefined} title={`${labels[index]}: ${format(value)}${unit}`}>
          <span className="e-bar-fill" style={{ height: `${Math.max(value > 0 ? 3 : 0, (value / max) * 100)}%` }} />
          <span className="e-bar-label">{labels[index]}</span>
        </div>
      ))}
    </div>
  );
}

/** A narrow bar per day, for runs or users over the period. */
export function DayBars({
  values,
  days,
  height = 64,
  label,
  tone,
}: {
  values: number[];
  days: string[];
  height?: number;
  label: string;
  tone?: "violet";
}) {
  const max = Math.max(1, ...values);
  return (
    <div className="e-daybars" data-tone={tone} style={{ height }} role="img" aria-label={label}>
      {values.map((value, index) => (
        <span key={days[index] ?? index} style={{ height: `${(value / max) * 100}%` }} title={`${days[index] ? shortDay(days[index]) : ""}: ${compact(value)}`} />
      ))}
    </div>
  );
}

/** Ranked horizontal bars with a share and a value. */
export function Ranked({
  items,
  format = compact,
}: {
  items: { label: string; value: number; sub?: string; color?: string }[];
  format?: (value: number) => string;
}) {
  const total = items.reduce((sum, item) => sum + item.value, 0) || 1;
  const max = Math.max(1, ...items.map((item) => item.value));
  return (
    <ol className="e-ranked">
      {items.map((item) => (
        <li key={item.label}>
          <div className="e-ranked-head">
            <span className="e-ranked-label">{item.label}</span>
            <span className="e-ranked-value">
              {format(item.value)} <span className="e-dim">{((item.value / total) * 100).toFixed(1)}%</span>
            </span>
          </div>
          <span className="e-ranked-track">
            <span className="e-ranked-fill" style={{ width: `${(item.value / max) * 100}%`, background: item.color }} />
          </span>
          {item.sub && <span className="e-ranked-sub">{item.sub}</span>}
        </li>
      ))}
    </ol>
  );
}

/** One bar split by kind, with its legend and each kind's share. */
export function KindSplit({ kinds }: { kinds: Record<KindKey, number> }) {
  const total = KINDS.reduce((sum, kind) => sum + kinds[kind.key], 0);
  return (
    <div className="e-split">
      <div className="e-split-bar">
        {KINDS.map((kind) =>
          kinds[kind.key] > 0 ? (
            <span
              key={kind.key}
              style={{ width: `${(kinds[kind.key] / Math.max(1, total)) * 100}%`, background: kind.color }}
              title={`${kind.label}: ${compact(kinds[kind.key])}`}
            />
          ) : null,
        )}
      </div>
      <ul className="e-legend">
        {KINDS.map((kind) => (
          <li key={kind.key}>
            <i style={{ background: kind.color }} />
            <span className="e-legend-label">{kind.label}</span>
            <span className="e-legend-value">{compact(kinds[kind.key])}</span>
            <span className="e-dim">{total > 0 ? `${((kinds[kind.key] / total) * 100).toFixed(1)}%` : "—"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A ring gauge for a 0–1 ratio, with the figure in the middle. */
export function Ring({ value, label, size = 112 }: { value: number; label: string; size?: number }) {
  const r = 44;
  const circumference = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <div className="e-ring" style={{ width: size, height: size }}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={r} className="e-ring-track" />
        <circle
          cx="50"
          cy="50"
          r={r}
          className="e-ring-fill"
          strokeDasharray={`${clamped * circumference} ${circumference}`}
          transform="rotate(-90 50 50)"
        />
      </svg>
      <div className="e-ring-text">
        <span className="e-ring-value">{(clamped * 100).toFixed(1)}%</span>
        <span className="e-ring-label">{label}</span>
      </div>
    </div>
  );
}

/** A small line of the last few weeks, for a table row. */
export function Spark({ values, label }: { values: number[]; label: string }) {
  const width = 96;
  const height = 22;
  const max = Math.max(1, ...values);
  const points = values.map((value, index) => `${((index / Math.max(1, values.length - 1)) * width).toFixed(1)},${(height - 2 - (value / max) * (height - 4)).toFixed(1)}`);
  return (
    <svg className="e-spark" viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label}>
      <path d={`M0,${height} L${points.join(" L")} L${width},${height} Z`} className="e-spark-area" />
      <path d={`M${points.join(" L")}`} className="e-spark-line" />
    </svg>
  );
}

const MONTH_LETTERS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A year of days as square cells, Monday at the top, coloured by quartile of
 * the person's own active days, so a light user's busy day is as bright as a
 * heavy user's.
 */
export function YearGrid({ values, end }: { values: Map<string, number>; end: string }) {
  const endDate = new Date(`${end}T00:00:00Z`);
  // Back to the Monday 52 weeks before the week `end` is in.
  const endWeekday = (endDate.getUTCDay() + 6) % 7;
  const start = new Date(endDate);
  start.setUTCDate(start.getUTCDate() - endWeekday - 52 * 7);

  const active = [...values.values()].filter((value) => value > 0).sort((a, b) => a - b);
  const q = (f: number) => active[Math.min(active.length - 1, Math.floor(f * active.length))] ?? 0;
  const cuts = [q(0.25), q(0.5), q(0.75)];
  const level = (value: number) => (value <= 0 ? 0 : value <= cuts[0]! ? 1 : value <= cuts[1]! ? 2 : value <= cuts[2]! ? 3 : 4);

  const weeks: { day: string; value: number; future: boolean }[][] = [];
  const months: { week: number; label: string }[] = [];
  const cursor = new Date(start);
  for (let week = 0; week < 53; week++) {
    const column: { day: string; value: number; future: boolean }[] = [];
    for (let weekday = 0; weekday < 7; weekday++) {
      const day = cursor.toISOString().slice(0, 10);
      if (cursor.getUTCDate() === 1) months.push({ week, label: MONTH_LETTERS[cursor.getUTCMonth()] ?? "" });
      column.push({ day, value: values.get(day) ?? 0, future: cursor > endDate });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(column);
  }

  return (
    <div className="e-year">
      <div className="e-year-months" aria-hidden="true">
        {months.map((month) => (
          <span key={`${month.week}-${month.label}`} style={{ gridColumnStart: month.week + 1 }}>
            {month.label}
          </span>
        ))}
      </div>
      <div className="e-year-grid" role="img" aria-label="tokens per day over the last year">
        {weeks.map((column, index) => (
          <div key={index} className="e-year-week">
            {column.map((cell) => (
              <span key={cell.day} data-level={cell.future ? undefined : level(cell.value)} data-future={cell.future || undefined} title={cell.future ? undefined : `${shortDay(cell.day)}: ${compact(cell.value)} tokens`} />
            ))}
          </div>
        ))}
      </div>
      <div className="e-year-scale" aria-hidden="true">
        less
        {[0, 1, 2, 3, 4].map((n) => (
          <span key={n} data-level={n} />
        ))}
        more
      </div>
    </div>
  );
}
