"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { ShareBars } from "@/components/Charts";

/**
 * A share-bar list that pages once it gets long.
 *
 * Someone who has tried twenty models gets a list twenty rows deep, and the
 * three that account for most of the spend end up above a page of rows worth
 * fractions of a percent. The long tail is worth keeping, but not at the cost
 * of the section it belongs to.
 *
 * Bars are scaled against the whole set rather than the visible page. Left to
 * itself `ShareBars` measures against the rows it is handed, so page two would
 * draw its largest row at full width — the bars would contradict the
 * percentages printed next to them.
 *
 * Below the threshold nothing changes: no controls, no page counter, and no
 * state worth having.
 */
export function PagedBars({
  rows,
  pageSize = 8,
}: {
  rows: { key?: string; label: string; value: number; display: string; icon?: ReactNode }[];
  pageSize?: number;
}) {
  const [page, setPage] = useState(0);

  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const pages = Math.ceil(rows.length / pageSize);

  if (pages <= 1) return <ShareBars rows={rows} />;

  // Clamped rather than trusted: rows can shrink under a cached page number.
  const current = Math.min(page, pages - 1);
  const start = current * pageSize;
  const shown = rows.slice(start, start + pageSize);

  return (
    <>
      <ShareBars rows={shown} total={total} />

      <div className="bars-pager">
        <span className="micro">
          {start + 1}–{start + shown.length} of {rows.length}
        </span>
        <div className="bars-pager-buttons">
          <button
            type="button"
            className="btn bare"
            onClick={() => setPage(current - 1)}
            disabled={current === 0}
            aria-label="previous page"
          >
            ←
          </button>
          <button
            type="button"
            className="btn bare"
            onClick={() => setPage(current + 1)}
            disabled={current >= pages - 1}
            aria-label="next page"
          >
            →
          </button>
        </div>
      </div>
    </>
  );
}
