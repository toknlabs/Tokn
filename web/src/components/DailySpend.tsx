"use client";

import { useMemo, useState } from "react";
import { ModelName } from "@/components/BrandLogo";
import { Cells } from "@/components/Cells";
import { compact, count, money, niceDay, percent } from "@/lib/format";
import type { LogoMap } from "@/lib/logos";

/**
 * Spend per day, one bar each, and everything about the day under the cursor.
 *
 * The area chart this replaces drew only days that had usage, so a quiet
 * week vanished from the x-axis, and the figure for a day was in a native
 * tooltip that most people never found. Here every calendar day in the range
 * gets a bar, quiet ones included, and the selected day's figures sit under
 * the chart.
 *
 * Nothing pops up and nothing is hidden behind a hover. Pointer, tap and the
 * arrow keys all move the same selection, and the panel always shows a day
 * (the latest with usage until something else is picked), so the page does not
 * jump as the pointer crosses the chart.
 *
 * `today` comes from the server. Reading the clock here would render a
 * different range on the server and in the browser and fail hydration.
 */

export interface SpendDay {
  day: string;
  cost: number;
  tokens: number;
  requests: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  models: { model?: string; label: string; cost: number }[];
}

const RANGES = [
  { key: "30", label: "30d", days: 30 },
  { key: "90", label: "90d", days: 90 },
  { key: "365", label: "1y", days: 365 },
  { key: "all", label: "all", days: null },
] as const;

type RangeKey = (typeof RANGES)[number]["key"];
type Sort = "recent" | "spend";

const PAGE = 10;
/** Model rows the day panel always draws, so its height never changes. */
const MODEL_ROWS = 3;
const HEIGHT = 160;

export function DailySpend({
  days,
  today,
  chart = "bars",
  list = true,
  logoMap,
}: {
  days: SpendDay[];
  today: string;
  /** The look: a column per day, or one line through them. */
  chart?: "bars" | "line";
  /** False for the "compact" look, which stops at the selected day. */
  list?: boolean;
  logoMap?: LogoMap;
}) {
  const [range, setRange] = useState<RangeKey>("90");
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState<Sort>("recent");
  const [page, setPage] = useState(0);

  const byDay = useMemo(() => new Map(days.map((d) => [d.day, d])), [days]);

  // Every calendar day in the range, quiet ones included.
  const series = useMemo(() => {
    const span = RANGES.find((r) => r.key === range)!.days;
    const first = days[0]?.day ?? today;
    const from = span === null ? first : shift(today, -(span - 1));
    const out: string[] = [];
    for (let day = from; day <= today; day = shift(day, 1)) out.push(day);
    return out;
  }, [range, days, today]);

  const active = series
    .map((day) => byDay.get(day))
    .filter((d): d is SpendDay => d !== undefined);
  const total = active.reduce((sum, d) => sum + d.cost, 0);
  const max = Math.max(...active.map((d) => d.cost), 0) || 1;

  // The picked day, if it is still in range; otherwise the latest with usage.
  const current =
    (selected && series.includes(selected) ? selected : null) ??
    active[active.length - 1]?.day ??
    today;
  const detail = byDay.get(current);

  const pick = (day: string) => setSelected(day);
  const step = (by: number) => {
    const index = series.indexOf(current) + by;
    if (index >= 0 && index < series.length) pick(series[index]!);
  };

  const listed = [...active].sort((a, b) =>
    sort === "spend" ? b.cost - a.cost : b.day.localeCompare(a.day),
  );
  const pages = Math.max(1, Math.ceil(listed.length / PAGE));
  const shown = listed.slice(
    Math.min(page, pages - 1) * PAGE,
    Math.min(page, pages - 1) * PAGE + PAGE,
  );

  const W = 1000;
  const slot = W / series.length;
  const gap = series.length > 120 ? 0 : Math.min(slot * 0.25, 3);

  return (
    <section>
      <div className="row spread" style={{ alignItems: "flex-end", gap: "1rem" }}>
        <div>
          <p className="block-label">spend per day</p>
          <p className="block-value">{money(total, 2)}</p>
        </div>
        <div className="picker-pills" role="group" aria-label="range">
          {RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              className="pill"
              data-on={r.key === range ? "" : undefined}
              aria-pressed={r.key === range}
              onClick={() => {
                setRange(r.key);
                setPage(0);
              }}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      <div
        className="daybars"
        tabIndex={0}
        role="group"
        aria-label={`spend per day, ${detail ? `${niceDay(current)} selected` : "no day selected"}. Arrow keys move between days.`}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") step(-1);
          else if (event.key === "ArrowRight") step(1);
          else if (event.key === "Home") pick(series[0]!);
          else if (event.key === "End") pick(series[series.length - 1]!);
          else return;
          event.preventDefault();
        }}
      >
        <svg
          viewBox={`0 0 ${W} ${HEIGHT}`}
          preserveAspectRatio="none"
          style={{ display: "block", width: "100%", height: HEIGHT }}
          aria-hidden="true"
        >
          {chart === "line" && <Line series={series} byDay={byDay} max={max} current={current} />}
          {series.map((day, index) => {
            const cost = byDay.get(day)?.cost ?? 0;
            const h = cost > 0 ? Math.max((cost / max) * (HEIGHT - 4), 2) : 1;
            return (
              <g key={day}>
                {chart === "bars" && (
                  <rect
                    x={index * slot + gap / 2}
                    y={HEIGHT - h}
                    width={Math.max(slot - gap, 0.6)}
                    height={h}
                    className={day === current ? "d on" : cost > 0 ? "d" : "d quiet"}
                  />
                )}
                {/* The full column is the target, so a short bar is as easy
                    to hit as a tall one. */}
                <rect
                  x={index * slot}
                  y={0}
                  width={slot}
                  height={HEIGHT}
                  fill="transparent"
                  onPointerEnter={() => pick(day)}
                  onClick={() => pick(day)}
                />
              </g>
            );
          })}
        </svg>
      </div>
      <div className="axis">
        <span>{niceDay(series[0]!)}</span>
        <span>today</span>
      </div>

      {/* ------------------------------------------------------ the day */}

      {/* One fixed shape for every day. The panel used to grow and shrink
          with the day under the pointer (a quiet day was one short line, a
          busy one four rows of models), which shoved everything below it up
          and down as the pointer crossed the chart. Near the bottom of the
          page the browser then moved the scroll position, the chart slid
          under the pointer, and a different day got picked: a visible jitter.
          Now the same cells and the same number of model rows always render,
          blank where a day has nothing to fill them. */}
      <div className="day-detail">
        <p className="micro">
          {weekday(current)} {niceDay(current)}
        </p>
        <Cells items={dayCells(detail, total)} />
        <ul className="day-models">
          {Array.from({ length: MODEL_ROWS }, (_, index) => {
            const m = detail?.models[index];
            return (
              <li key={index} aria-hidden={m ? undefined : true} data-empty={m ? undefined : ""}>
                <span className="sub">
                  {m ? (
                    <ModelName model={m.model ?? m.label} label={m.label} logoMap={logoMap} size={13} />
                  ) : (
                    "—"
                  )}
                </span>
                <span className="bar">
                  <span
                    style={{
                      width: m && detail ? `${Math.max((m.cost / detail.cost) * 100, 0.8)}%` : 0,
                    }}
                  />
                </span>
                <span>{m ? money(m.cost, 2) : "—"}</span>
              </li>
            );
          })}
          <li className="day-models-more" data-empty={moreModels(detail) ? undefined : ""}>
            {moreModels(detail) || "\u00a0"}
          </li>
        </ul>
      </div>

      {/* ------------------------------------------------------ the list */}

      {list && listed.length > 0 && (
        <div style={{ marginTop: "1.75rem" }}>
          <div className="row spread" style={{ gap: "1rem" }}>
            <p className="micro">
              {count(listed.length)} {listed.length === 1 ? "day" : "days"} with usage
            </p>
            <div className="picker-pills" role="group" aria-label="sort days">
              {(["recent", "spend"] as const).map((key) => (
                <button
                  key={key}
                  type="button"
                  className="pill"
                  data-on={sort === key ? "" : undefined}
                  aria-pressed={sort === key}
                  onClick={() => {
                    setSort(key);
                    setPage(0);
                  }}
                >
                  {key === "recent" ? "newest" : "highest"}
                </button>
              ))}
            </div>
          </div>

          <div className="table-wrap" style={{ marginTop: "0.6rem" }}>
            <table className="whatif day-list">
              <thead>
                <tr>
                  <th>day</th>
                  <th className="r">spend</th>
                  <th className="r">tokens</th>
                  <th className="r">requests</th>
                  <th className="r">top model</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((d) => (
                  <tr
                    key={d.day}
                    data-on={d.day === current ? "" : undefined}
                    onClick={() => pick(d.day)}
                  >
                    <td>
                      <button type="button" className="day-link" onClick={() => pick(d.day)}>
                        {niceDay(d.day)}
                      </button>
                    </td>
                    <td className="r">{money(d.cost, 2)}</td>
                    <td className="r sub">{compact(d.tokens)}</td>
                    <td className="r sub">{count(d.requests)}</td>
                    <td className="r sub">
                      {d.models[0] ? (
                        <ModelName
                          model={d.models[0].model ?? d.models[0].label}
                          label={d.models[0].label}
                          logoMap={logoMap}
                          size={13}
                        />
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {pages > 1 && (
            <div className="bars-pager">
              <span className="micro">
                page {Math.min(page, pages - 1) + 1} of {pages}
              </span>
              <div className="bars-pager-buttons">
                <button
                  type="button"
                  className="btn bare"
                  onClick={() => setPage(Math.min(page, pages - 1) - 1)}
                  disabled={Math.min(page, pages - 1) === 0}
                  aria-label="previous page"
                >
                  ←
                </button>
                <button
                  type="button"
                  className="btn bare"
                  onClick={() => setPage(Math.min(page, pages - 1) + 1)}
                  disabled={Math.min(page, pages - 1) >= pages - 1}
                  aria-label="next page"
                >
                  →
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/**
 * The "line" look: one stroke through every day, a faint fill under it, and
 * a marker on the selected day. Drawn under the hit columns so they still
 * take the pointer.
 */
function Line({
  series,
  byDay,
  max,
  current,
}: {
  series: string[];
  byDay: Map<string, SpendDay>;
  max: number;
  current: string;
}) {
  const W = 1000;
  const step = series.length > 1 ? W / (series.length - 1) : W;
  const y = (cost: number) => HEIGHT - 3 - (cost / max) * (HEIGHT - 8);
  const points = series.map((day, index) => `${index * step},${y(byDay.get(day)?.cost ?? 0)}`);
  const at = series.indexOf(current);
  const cost = byDay.get(current)?.cost ?? 0;

  return (
    <>
      <polygon points={`0,${HEIGHT} ${points.join(" ")} ${W},${HEIGHT}`} className="l-fill" />
      <polyline points={points.join(" ")} className="l-line" vectorEffect="non-scaling-stroke" />
      {at >= 0 && (
        <>
          <line
            x1={at * step}
            x2={at * step}
            y1={0}
            y2={HEIGHT}
            className="l-mark"
            vectorEffect="non-scaling-stroke"
          />
          {/* A zero-length line with a round cap: the chart stretches to its
              width, which would squash a <circle> into an oval on a phone,
              while a non-scaling stroke stays round. */}
          <line
            x1={at * step}
            x2={at * step}
            y1={y(cost)}
            y2={y(cost)}
            className="l-dot"
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
    </>
  );
}

/** The day's four figures. A quiet day gets the same four, as dashes. */
function dayCells(detail: SpendDay | undefined, total: number) {
  if (!detail) {
    return ["spend", "tokens", "requests", "per request"].map((k) => ({
      k,
      v: "—",
      idle: true,
      note: "no usage",
    }));
  }
  const sent = detail.input + detail.cacheRead + detail.cacheWrite;
  return [
    { k: "spend", v: money(detail.cost, 2), note: share(detail.cost, total) },
    { k: "tokens", v: compact(detail.tokens), note: `${compact(detail.output)} output` },
    {
      k: "requests",
      v: count(detail.requests),
      note: `${compact(detail.tokens / Math.max(detail.requests, 1))} tokens each`,
    },
    {
      k: "per request",
      v: money(detail.cost / Math.max(detail.requests, 1)),
      note: sent > 0 ? `${percent(detail.cacheRead, sent)} from cache` : "no input",
    },
  ];
}

/** "+2 more models · $4.10", for whatever does not fit the fixed rows. */
function moreModels(detail: SpendDay | undefined): string {
  const rest = detail?.models.slice(MODEL_ROWS) ?? [];
  if (rest.length === 0) return "";
  const cost = rest.reduce((sum, m) => sum + m.cost, 0);
  return `+${rest.length} more ${rest.length === 1 ? "model" : "models"} · ${money(cost, 2)}`;
}

/** Share of the range, without rounding a small day down to "0%". */
function share(part: number, whole: number): string {
  if (whole <= 0) return "";
  return part / whole < 0.01 ? "under 1% of the range" : `${percent(part, whole)} of the range`;
}

function shift(day: string, by: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + by);
  return date.toISOString().slice(0, 10);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function weekday(day: string): string {
  return WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()]!;
}
