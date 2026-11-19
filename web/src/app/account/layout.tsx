import { redirect } from "next/navigation";
import { AccountNav } from "@/components/AccountNav";
import { Avatar } from "@/components/Avatar";
import { currentUser } from "@/lib/auth";
import { getTotals } from "@/lib/backend";
import { compact, money } from "@/lib/format";
import { isOwner } from "@/lib/owner";
import { parsePrefs } from "@/lib/prefs";

/**
 * The account section.
 *
 * Everything that belongs to one person lives under `/account` — their stats,
 * their friends, their settings — behind one header and one row of tabs, so
 * there is a single place to go rather than three unrelated top-level pages.
 *
 * The sign-in check lives here rather than in each page: a layout wraps every
 * route beneath it, so no child can be reached without it.
 */

export default async function AccountLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/account");

  const totals = await getTotals(user.id);
  const prefs = parsePrefs(user.prefs);

  return (
    <>
      <header className="account-head">
        <Avatar
          handle={user.handle}
          size={40}
          style={prefs.avatar}
          url={user.avatarUrl}
        />

        <div style={{ minWidth: 0 }}>
          <p className="account-name">{user.name?.trim() || user.handle}</p>
          <p className="micro">
            @{user.handle}
            {totals ? (
              <>
                {" "}
                <span className="dot-sep">·</span> {money(totals.costUsd, 2)}{" "}
                <span className="dot-sep">·</span> {compact(totals.tokens)}{" "}
                tokens
              </>
            ) : null}
          </p>
        </div>
      </header>

      <AccountNav handle={user.handle} owner={isOwner(user.id)} />

      {children}
    </>
  );
}
