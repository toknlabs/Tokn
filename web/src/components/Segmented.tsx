"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * Segmented control whose active pill physically slides between options.
 *
 * Two backgrounds cross-fading reads as two things; one pill moving reads as
 * one thing, which is what the user is actually doing. The thumb is measured
 * from the live DOM so it stays correct as labels or fonts change.
 *
 * Options are links, not buttons: the leaderboard's filter state lives in the
 * URL, so every view stays shareable and the back button works.
 */

export interface SegmentOption<T extends string> {
  key: T;
  label: string;
  href: string;
}

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function Segmented<T extends string>({
  options,
  active,
  ariaLabel,
}: {
  options: SegmentOption<T>[];
  active: T;
  ariaLabel: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; w: number } | null>(null);

  useIsomorphicLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const current = list.querySelector<HTMLElement>('[data-active="true"]');
      if (!current) return;
      setThumb({ x: current.offsetLeft - 2, w: current.offsetWidth });
    };

    measure();

    // Fonts land after first paint and can change every label's width.
    const observer = new ResizeObserver(measure);
    observer.observe(list);
    return () => observer.disconnect();
  }, [active, options]);

  return (
    <div className="segmented" ref={listRef} role="group" aria-label={ariaLabel}>
      {thumb && (
        <span
          className="thumb"
          aria-hidden="true"
          style={{ width: thumb.w, transform: `translateX(${thumb.x}px)` }}
        />
      )}

      {options.map((option) => (
        <Link
          key={option.key}
          href={option.href}
          className="seg"
          data-active={option.key === active}
          aria-current={option.key === active ? "true" : undefined}
          scroll={false}
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}
