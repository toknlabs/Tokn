"use client";

import { useEffect, useState } from "react";

/** Copies the profile URL. Falls back silently if the clipboard is blocked. */
export function ShareButton({ handle, path }: { handle: string; path?: string }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  async function share() {
    // `path` for the Eaon profile: `/@handle` on its own host, or its full
    // address when the page is being read on toknhq.com.
    const target = path ?? `/profile/${handle}`;
    const url = /^https?:\/\//.test(target) ? target : `${window.location.origin}${target}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Insecure origin or denied permission; the address bar still works.
    }
  }

  return (
    <button type="button" className="btn" onClick={share}>
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden="true"
      >
        <path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" />
        <path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" />
      </svg>
      {copied ? "copied" : "share"}
    </button>
  );
}
