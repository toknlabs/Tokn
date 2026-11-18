"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { compact, count, money } from "@/lib/format";

/**
 * The interactive half of the models section.
 *
 * Hovering a segment or a legend row reports that model: the ring dims
 * everything else, the centre swaps to it, and the line underneath fills in
 * the rest of the numbers.
 *
 * That line is always showing something — the largest model when nothing is
 * hovered — rather than appearing on hover. A detail strip that pops into
 * existence pushes the table down the page every time the pointer crosses the
 * chart, and an empty reserved gap is worse than a useful one.
 *
 * No floating tooltip. A box that follows the cursor is chrome this design does
 * not otherwise have, and it is unreachable by keyboard and meaningless on a
 * phone. Segments and legend rows are both real buttons, so hover, tap and Tab
 * all do the same thing.
 */

export interface RingSlice {
  key: string;
  label: string;
  /** Share of tokens, 0..1. */
  share: number;
  tokens: number;
  cost: number;
  /** Share of spend, 0..1. */
  costShare: number;
  requests: number;
  /** Null for the folded tail, where per-model sets would double count. */
  users: number | null;
  /** How many models the slice stands for; 1 unless it is the tail. */
  models: number;
  shade: string;
  /** Optional monochrome icon rendered alongside the slice label. */
  icon?: ReactNode;
}

/** Circumference of a circle with r = 15.9155, so lengths read as percents. */
const R = 15.9155;

/** Separation between arcs, in the same percent units. */
const GAP = 0.7;

export function ModelRing({
  slices,
  noun = "model",
}: {
  slices: RingSlice[];
  /** What a slice is, for the folded tail's count: "model" or "tool". */
  noun?: string;
}) {
  const [active, setActive] = useState<string | null>(null);

  const lead = slices[0]!;
  const shown = slices.find((slice) => slice.key === active) ?? lead;
  const dimmed = active !== null;

  let offset = 0;

  return (
    <>
      <div className="mix">
        <div className="mix-ring" data-dimmed={dimmed}>
          <svg
            viewBox="0 0 42 42"
            role="img"
            aria-label="share of tokens by model"
          >
            {slices.map((slice) => {
              const length = slice.share * 100;
              // A hairline of background between arcs. Clamped so a sliver of
              // a slice does not go negative and wrap around the whole ring.
              const drawn = Math.max(length - GAP, length * 0.35);
              const start = 25 - offset;
              offset += length;

              return (
                <circle
                  key={slice.key}
                  className="mix-arc"
                  data-on={slice.key === shown.key}
                  cx="21"
                  cy="21"
                  r={R}
                  fill="none"
                  stroke={slice.shade}
                  strokeWidth="4.2"
                  strokeDasharray={`${drawn} ${100 - drawn}`}
                  strokeDashoffset={start}
                  onPointerEnter={() => setActive(slice.key)}
                  onPointerLeave={() => setActive(null)}
                />
              );
            })}
          </svg>

          <div className="mix-centre">
            <span className="mix-pct">{(shown.share * 100).toFixed(1)}%</span>
            <span className="mix-lead">{shown.label}</span>
          </div>
        </div>

        <ul className="mix-legend">
          {slices.map((slice) => (
            <li key={slice.key}>
              <button
                type="button"
                className="mix-row"
                data-on={slice.key === shown.key}
                onPointerEnter={() => setActive(slice.key)}
                onPointerLeave={() => setActive(null)}
                onFocus={() => setActive(slice.key)}
                onBlur={() => setActive(null)}
              >
                <span className="mix-dot" style={{ background: slice.shade }} />
                {slice.icon ? (
                  <span className="mix-name brand-item">
                    {slice.icon}
                    <span className="brand-label">{slice.label}</span>
                  </span>
                ) : (
                  <span className="mix-name">{slice.label}</span>
                )}
                <span className="mix-share">
                  {(slice.share * 100).toFixed(1)}%
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <p className="mix-detail" aria-live="polite">
        <span className="mix-detail-name">
          {shown.icon}
          <span>{shown.label}</span>
        </span>
        <Fact>{compact(shown.tokens)} tokens</Fact>
        <Fact>
          {money(shown.cost, 2)} · {(shown.costShare * 100).toFixed(1)}% of
          spend
        </Fact>
        <Fact>{count(shown.requests)} requests</Fact>
        {/* A single model's slice has no count worth stating; "1 models"
            is what it used to say on a profile. */}
        {(shown.users !== null || shown.models > 1) && (
          <Fact>
            {shown.users === null
              ? `${shown.models} ${noun}s`
              : `${count(shown.users)} ${shown.users === 1 ? "dev" : "devs"}`}
          </Fact>
        )}
      </p>
    </>
  );
}

function Fact({ children }: { children: React.ReactNode }) {
  return (
    <>
      <span className="dot-sep" aria-hidden="true">
        ·
      </span>
      <span>{children}</span>
    </>
  );
}
