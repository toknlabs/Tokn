import { niceDay } from "@/lib/format";

/**
 * Hand-rolled SVG charts.
 *
 * No charting library: these render on the server, read the theme through CSS
 * variables, and ship no JavaScript. Tooltips are native `<title>` elements,
 * which work with scripting disabled.
 *
 * The house style is deliberately bare — no gridlines, no axis ticks, one
 * stroke and one soft fill. The shape of the data is the whole point; the
 * numbers live in the label above the chart.
 */

export interface SeriesPoint {
  day: string;
  value: number;
}

/* ------------------------------------------------------------ area chart */

/**
 * A filled trend line with no chrome. Start and end dates sit below it.
 *
 * The fill is a gradient that dies out before the baseline. A flat wash of the
 * accent across a wide chart turns into a coloured block that competes with the
 * line; fading it keeps the stroke as the thing you read.
 */
export function AreaChart({
  points,
  format,
  height = 170,
}: {
  points: SeriesPoint[];
  format: (value: number) => string;
  height?: number;
}) {
  if (points.length < 2) return <p className="empty">not enough data yet</p>;

  const W = 1000;
  const pad = 6;
  const max = Math.max(...points.map((point) => point.value)) || 1;
  const fillId = `fade-${points.length}-${Math.round(max)}`;

  const xOf = (index: number) => (index / (points.length - 1)) * W;
  const yOf = (value: number) =>
    height - pad - (value / max) * (height - pad * 2);

  const line = points
    .map((point, index) => `${xOf(index)},${yOf(point.value)}`)
    .join(" ");
  const band = W / points.length;

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      style={{ display: "block", width: "100%", height: "auto" }}
      role="img"
      aria-label="daily trend"
      preserveAspectRatio="none"
    >
      <defs>
        <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--main)" stopOpacity={0.18} />
          <stop offset="100%" stopColor="var(--main)" stopOpacity={0} />
        </linearGradient>
      </defs>

      <polygon
        points={`0,${height} ${line} ${W},${height}`}
        fill={`url(#${fillId})`}
      />
      <polyline
        points={line}
        fill="none"
        stroke="var(--main)"
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        strokeOpacity={0.9}
        vectorEffect="non-scaling-stroke"
      />

      {points.map((point, index) => (
        /* A wide invisible band gives the tooltip something to hit. */
        <rect
          key={point.day}
          x={xOf(index) - band / 2}
          y={0}
          width={Math.max(band, 2)}
          height={height}
          fill="transparent"
        >
          <title>{`${niceDay(point.day)} · ${format(point.value)}`}</title>
        </rect>
      ))}
    </svg>
  );
}

/* ------------------------------------------------------------ share bars */

/** Proportional split as labelled hairline bars. */
export function ShareBars({
  rows,
  total: scale,
}: {
  rows: { label: string; value: number; display: string }[];
  /**
   * What the bars are measured against, when that is not the rows given.
   *
   * A paged list has to pass the whole set's total. Scaling each page to its
   * own rows would draw the smallest model on the last page at full width,
   * which reads as the largest — the bars would say the opposite of the
   * numbers printed beside them.
   */
  total?: number;
}) {
  const total = scale ?? rows.reduce((sum, row) => sum + row.value, 0);
  if (total <= 0) return <p className="empty">no data yet</p>;

  return (
    <div style={{ display: "grid", gap: "0.85rem" }}>
      {rows.map((row) => (
        <div key={row.label}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "0.75rem",
              marginBottom: "0.4rem",
            }}
          >
            <span className="sub" style={{ fontSize: "0.8125rem" }}>
              {row.label}
            </span>
            <span style={{ fontSize: "0.8125rem" }}>{row.display}</span>
          </div>
          <div className="bar">
            <span
              style={{ width: `${Math.max((row.value / total) * 100, 0.8)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}


/* ------------------------------------------------------- stacked day bars */

export interface DayStack {
  day: string;
  /** Widest band first; drawn bottom-up in this order. */
  parts: { label: string; value: number }[];
}

/**
 * Tokens per day, split by kind.
 *
 * Stacked rather than a single line, though it is worth being honest about
 * what that buys: on a cache-heavy profile cache reads are ~98% of volume, so
 * the other three bands are sub-pixel and the chart reads as one solid colour.
 * The stack earns its place on the days and profiles where the mix is not
 * lopsided — early days before a cache exists, or output-heavy work — and the
 * hover text carries the split on every day regardless.
 *
 * Scaled to the tallest day rather than to a fixed ceiling, because token
 * counts span orders of magnitude between people and a shared scale would
 * flatten most profiles to nothing.
 */
export function StackedDays({
  days,
  format,
  height = 150,
}: {
  days: DayStack[];
  format: (value: number) => string;
  height?: number;
}) {
  if (days.length < 2) return <p className="empty">not enough data yet</p>;

  const W = 1000;
  const max = Math.max(...days.map((d) => d.parts.reduce((n, p) => n + p.value, 0))) || 1;
  // A gap only where there is room for one; at 90 days the bars are thinner
  // than the gap would be, and the chart turns into a comb.
  const slot = W / days.length;
  const gap = slot > 6 ? Math.min(2, slot * 0.18) : 0;
  const barWidth = Math.max(0.6, slot - gap);

  const shades = [
    "var(--main)",
    "color-mix(in srgb, var(--main) 55%, var(--sub-alt))",
    "color-mix(in srgb, var(--main) 25%, var(--sub-alt))",
    "var(--sub-alt)",
  ];

  return (
    <svg
      viewBox={`0 0 ${W} ${height}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height, display: "block" }}
      role="img"
      aria-label="tokens per day, by kind"
    >
      {days.map((day, index) => {
        const total = day.parts.reduce((n, p) => n + p.value, 0);
        let y = height;
        // One string, not two children. React separates adjacent text nodes
        // differently on the server than on the client, which shows up as a
        // hydration mismatch rather than as anything visible.
        const tip = [
          `${niceDay(day.day)} · ${format(total)}`,
          ...day.parts
            .filter((part) => part.value > 0)
            .map((part) => `${part.label} ${format(part.value)}`),
        ].join("\n");
        return (
          <g key={day.day}>
            <title>{tip}</title>
            {day.parts.map((part, layer) => {
              if (part.value <= 0) return null;
              const h = (part.value / max) * height;
              y -= h;
              return (
                <rect
                  key={part.label}
                  x={index * slot}
                  y={y}
                  width={barWidth}
                  height={h}
                  fill={shades[layer] ?? "var(--sub-alt)"}
                />
              );
            })}
            {/* A day with nothing still gets a mark, so gaps read as quiet
                days rather than as missing data. */}
            {total === 0 && (
              <rect
                x={index * slot}
                y={height - 1}
                width={barWidth}
                height={1}
                fill="var(--sub-alt)"
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
