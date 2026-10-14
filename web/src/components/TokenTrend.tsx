"use client";

import { useState } from "react";
import { AreaChart, type SeriesPoint } from "@/components/Charts";
import { Segmented } from "@/components/Segmented";
import { compact, shortDay } from "@/lib/format";

/**
 * The profile's tokens chart: the all-time total, then a line over the range
 * the reader picks.
 *
 * The range is local state rather than a query parameter. It changes what one
 * chart draws, and re-rendering a whole profile on the server to redraw it
 * would make the switch feel like a page load.
 */

const RANGES = [
  { key: "30d", label: "30d", days: 30, words: "30 days" },
  { key: "90d", label: "90d", days: 90, words: "90 days" },
  { key: "1y", label: "1y", days: 365, words: "year" },
] as const;

type Range = (typeof RANGES)[number]["key"];

/** Labels along the axis: the ends and three between. */
const TICKS = 5;

export function TokenTrend({
  total,
  points,
  label = "tokens",
}: {
  total: number;
  /** One point per day, oldest first, ending today. At least a year of them. */
  points: SeriesPoint[];
  label?: string;
}) {
  const [range, setRange] = useState<Range>("30d");
  const spec = RANGES.find((entry) => entry.key === range) ?? RANGES[0];
  const shown = points.slice(-spec.days);
  const inRange = shown.reduce((sum, point) => sum + point.value, 0);

  const ticks = Array.from({ length: TICKS }, (_, index) => {
    const at = Math.round((index / (TICKS - 1)) * (shown.length - 1));
    const point = shown[at];
    if (!point) return "";
    return index === TICKS - 1 ? "today" : shortDay(point.day);
  });

  return (
    <section className="trend">
      <div className="trend-head">
        <div style={{ minWidth: 0 }}>
          <p className="block-label">{label}</p>
          <p className="block-value">{compact(total)} tokens</p>
          <p className="micro">
            {compact(inRange)} in the last {spec.words}
          </p>
        </div>
        <Segmented
          ariaLabel="chart range"
          active={range}
          onSelect={setRange}
          options={RANGES.map((entry) => ({ key: entry.key, label: entry.label }))}
        />
      </div>

      <div style={{ marginTop: "1.25rem" }}>
        <AreaChart
          points={shown}
          fill="solid"
          fixed
          height={150}
          format={(value) => `${compact(value)} tokens`}
        />
      </div>
      <div className="axis">
        {ticks.map((tick, index) => (
          <span key={index}>{tick}</span>
        ))}
      </div>
    </section>
  );
}
