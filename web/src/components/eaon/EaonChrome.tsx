import Link from "next/link";

/**
 * The frame around every page on tokns.eaon.dev. It is Eaon's, not tokn's:
 * Eaon's mark and blue, its own header and footer, always dark. tokn shows up
 * only as where the numbers come from and where to sign in.
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
        <Link href={boardHref} className="e-brand" aria-label="Eaon usage index, home">
          <EaonSymbol />
          <span className="e-brand-name">Eaon</span>
          <span className="e-brand-tag">tokns</span>
        </Link>
        <nav className="e-nav" aria-label="sections">
          <Link href={`${boardHref}#overview`}>index</Link>
          <Link href={`${boardHref}#records`}>records</Link>
          <Link href={`${boardHref}#board`}>board</Link>
          <a href="https://eaon.dev" className="e-nav-out">
            get Eaon
          </a>
        </nav>
        <a href={`${toknUrl}/account/eaon`} className="e-signin">
          Sign in with Tokn
        </a>
      </div>
    </header>
  );
}

export function EaonFooter({ toknUrl }: { toknUrl: string }) {
  return (
    <footer className="e-footer">
      <div className="e-wrap e-footer-inner">
        <span className="e-footer-brand">
          <EaonSymbol size={14} /> Eaon Desktop usage index
        </span>
        <span className="e-dim">
          Counted on each computer by Eaon Desktop and synced through{" "}
          <a href={toknUrl} className="e-link">
            Tokn
          </a>
          . Daily totals only, never prompts or code.
        </span>
        <nav className="e-footer-links">
          <a href={`${toknUrl}/privacy`}>privacy</a>
          <a href={`${toknUrl}/terms`}>terms</a>
          <a href={`${toknUrl}/about`}>about tokn</a>
        </nav>
      </div>
    </footer>
  );
}
