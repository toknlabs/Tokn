import Link from "next/link";

/**
 * The frame around every page on tokns.eaon.dev: Eaon's mark, a header of
 * two text links, a one-line footer. Light or dark with the system. Tokn
 * shows up only as where the numbers come from and where to sign in.
 */

/** Eaon's mark (resources/brand/eaon-symbol.svg in Eaon Desktop). */
export function EaonSymbol({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" className="e-symbol">
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M186.6 50A100 100 0 1 0 186.6 150H103A15 15 0 0 1 103 120H197.98A100 100 0 0 0 197.98 80H103A15 15 0 0 1 103 50Z"
      />
    </svg>
  );
}

export function EaonHeader({ toknUrl, boardHref }: { toknUrl: string; boardHref: string }) {
  return (
    <header className="e-header">
      <div className="e-wrap e-header-inner">
        <Link href={boardHref} className="e-brand" aria-label="Eaon Desktop leaderboard, home">
          <EaonSymbol size={18} />
          <span>Eaon</span>
        </Link>
        <nav className="e-nav" aria-label="Site">
          <a href="https://eaon.dev">Download</a>
          <a href={`${toknUrl}/account/eaon`}>Sign in</a>
        </nav>
      </div>
    </header>
  );
}

export function EaonFooter({ toknUrl }: { toknUrl: string }) {
  return (
    <footer className="e-footer">
      <div className="e-wrap e-footer-inner">
        <span>
          Counted on each computer by Eaon Desktop and synced through <a href={toknUrl}>Tokn</a>.
          Daily totals only, never prompts or code.
        </span>
        <nav className="e-footer-links" aria-label="Legal">
          <a href={`${toknUrl}/privacy`}>Privacy</a>
          <a href={`${toknUrl}/terms`}>Terms</a>
        </nav>
      </div>
    </footer>
  );
}
