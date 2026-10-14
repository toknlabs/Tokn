"use client";

import { useEffect, useRef, useState } from "react";
import { compact, count, money } from "@/lib/format";

/**
 * Counts a headline figure up on first paint.
 *
 * Only the four numbers at the top of the leaderboard use this. A number that
 * animates every time you glance at it is noise; a number that arrives once,
 * quickly, reads as a live instrument.
 *
 * The server-rendered value is the final one, so with JavaScript off or
 * reduced motion on, the correct figure is simply there.
 *
 * `format` is a name rather than a function: a server component cannot hand a
 * client component a callback, and the set of formats is small and fixed.
 */
export type TickerFormat = "money" | "usd0" | "compact" | "count";

const FORMATTERS: Record<TickerFormat, (value: number) => string> = {
  money: (value) => money(value, 2),
  usd0: (value) => money(value, 0),
  compact,
  count: (value) => count(Math.round(value)),
};

export function Ticker({
  value,
  format,
  duration = 700,
}: {
  value: number;
  format: TickerFormat;
  duration?: number;
}) {
  const render = FORMATTERS[format];
  const [shown, setShown] = useState(value);
  const frame = useRef(0);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced || value === 0) {
      setShown(value);
      return;
    }

    const start = performance.now();
    setShown(0);

    const step = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      // Strong ease-out: most of the distance is covered immediately, so the
      // number reads as settling rather than as a slot machine.
      const eased = 1 - Math.pow(1 - t, 4);
      setShown(value * eased);
      if (t < 1) frame.current = requestAnimationFrame(step);
    };

    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [value, duration]);

  return <>{render(shown)}</>;
}
