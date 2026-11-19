"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Tabs across the account section. The public profile is the way out of it.
 * The people who run the site also get the owner page (see lib/owner.ts).
 */
export function AccountNav({ handle, owner = false }: { handle: string; owner?: boolean }) {
  const pathname = usePathname();

  const TABS = [
    { href: "/account", label: "stats", exact: true },
    { href: "/account/friends", label: "friends" },
    { href: "/account/settings", label: "settings" },
    ...(owner ? [{ href: "/account/owner", label: "owner" }] : []),
  ];

  return (
    <nav className="subnav">
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className="subnav-tab"
          data-active={tab.exact ? pathname === tab.href : pathname.startsWith(tab.href)}
        >
          {tab.label}
        </Link>
      ))}

      <Link href={`/profile/${handle}`} className="subnav-tab out">
        public profile ↗
      </Link>
    </nav>
  );
}
