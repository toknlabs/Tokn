import Link from "next/link";

/**
 * The frame around every page on tokns.eaon.dev: Eaon's mark, a quiet
 * header and footer, always dark. Tokn shows up only as where the numbers
 * come from and where to sign in.
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
          <EaonSymbol size={20} />
          <span>Eaon</span>
          <span className="e-brand-sub">Leaderboard</span>
        </Link>
        <nav className="e-nav" aria-label="Sections">
          <a href="https://eaon.dev">Download Eaon</a>
          <a href={`${toknUrl}/account/eaon`} className="e-nav-signin">
            Sign in
          </a>
        </nav>
      </div>
    </header>
  );
}

export function EaonFooter({ toknUrl }: { toknUrl: string }) {
  return (
    <footer className="e-footer">
      <div className="e-wrap e-footer-inner">
        <span className="e-footer-brand">
          <EaonSymbol size={14} /> Eaon
        </span>
        <span>
          Usage is counted on each computer by Eaon Desktop and synced through{" "}
          <a href={toknUrl}>Tokn</a>: daily totals only, never prompts or code.
        </span>
        <nav className="e-footer-links" aria-label="Legal">
          <a href={`${toknUrl}/privacy`}>Privacy</a>
          <a href={`${toknUrl}/terms`}>Terms</a>
        </nav>
      </div>
    </footer>
  );
}
