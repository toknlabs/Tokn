import Link from "next/link";
import { ShareBars } from "@/components/Charts";
import { Avatar } from "@/components/Avatar";
import { Heatmap } from "@/components/Heatmap";
import { ShareButton } from "@/components/ShareButton";
import { SocialIcon } from "@/components/SocialIcon";
import { TokenTrend } from "@/components/TokenTrend";
import type { AgentSummary } from "@/lib/backend";
import { compact, count, duration, money, percent, shortDay } from "@/lib/format";
import { parseLinks } from "@/lib/links";
import { subscriptionMonthly, type Plan } from "@/lib/plans";
import { modelLabel } from "@/lib/pricing";
import { STAT_LABELS, type AvatarStyle, type StatKey } from "@/lib/prefs";
import { shiftDay, today, type UserStats } from "@/lib/stats";

/**
 * The top of a profile, on either site: who, four figures, a year of dots,
 * the tokens line, and a quiet row of facts under it.
 *
 * Everything that follows on toknhq.com — the cost anatomy, the plan verdict,
 * the paged model list — is for someone who came to read. This part is for
 * someone glancing, so it stays short and the same on both hosts. The Eaon
 * profile is this and nothing else, fed only Eaon Desktop's rows.
 */

export interface ProfileUser {
  id: string;
  handle: string;
  name: string | null;
  bio: string | null;
  createdAt: string;
  billing: string;
  links: string | null;
  prefs: string | null;
  plans: string | null;
  avatarUrl: string | null;
  isPublic: boolean;
  listed: boolean;
}

/** Days of tokens handed to the chart: its longest range, a year. */
const TREND_DAYS = 365;

export function ProfileTop({
  user,
  stats,
  agents,
  plans = [],
  statKeys,
  avatarStyle,
  own,
  identity = true,
  rank,
  rankHref,
  rankTitle,
  eaonRank,
  eaonBoardHref,
  sharePath,
  crossLink,
  showActivity = true,
  heatBy = "cost",
  empty,
}: {
  user: ProfileUser;
  stats: UserStats;
  agents: AgentSummary;
  plans?: Plan[];
  statKeys: StatKey[];
  avatarStyle: AvatarStyle;
  own: boolean;
  identity?: boolean;
  /** The rank beside the handle: the main board on tokn, the Eaon board on Eaon. */
  rank: number | null;
  rankHref: string;
  rankTitle: string;
  /** Rank on the Eaon board, for the facts row. */
  eaonRank: number | null;
  eaonBoardHref: string;
  /** What the share button copies, when it is not `/profile/<handle>`. */
  sharePath?: string;
  /** The same person on the other site. */
  crossLink?: { href: string; label: string } | null;
  showActivity?: boolean;
  heatBy?: "cost" | "tokens";
  /** Shown in place of the charts when there is nothing to draw. */
  empty: React.ReactNode;
}) {
  const links = parseLinks(user.links);
  const hasUsage = stats.totals.requests > 0 || stats.totals.tokens > 0;

  return (
    <>
      {identity && (
        <section className="profile-top">
          <div className="row spread" style={{ alignItems: "flex-start" }}>
            <div className="profile-head">
              <span className="profile-avatar">
                <Avatar handle={user.handle} size={56} style={avatarStyle} url={user.avatarUrl} />
              </span>
              <div style={{ minWidth: 0 }}>
                <h1 className="profile-name">{user.name?.trim() || user.handle}</h1>
                <div className="profile-handle">
                  <span>@{user.handle}</span>
                  {user.billing === "subscription" && <span className="tag">plan</span>}
                  {rank && (
                    <Link href={rankHref} className="tag on link" title={rankTitle}>
                      #{rank}
                    </Link>
                  )}
                  {own && !user.isPublic && <span className="tag">private</span>}
                  {own && user.isPublic && !user.listed && <span className="tag">unlisted</span>}
                </div>
              </div>
            </div>

            <div className="row" style={{ gap: "0.5rem" }}>
              <ShareButton handle={user.handle} path={sharePath} />
              {own && (
                <Link href="/account/settings" className="btn">
                  edit
                </Link>
              )}
            </div>
          </div>

          <div className="profile-meta">
            <span className="sub">joined {sinceJoin(user.createdAt)}</span>

            {links.length > 0 && (
              <div className="links">
                {links.map((link) => (
                  <a key={link.url} href={link.url} target="_blank" rel="me noreferrer noopener">
                    <SocialIcon provider={link.provider} size={13} />
                    {link.label}
                  </a>
                ))}
              </div>
            )}

            {own && links.length === 0 && (
              <Link href="/account/settings" className="sub link">
                + add github or x
              </Link>
            )}

            {crossLink && (
              <a href={crossLink.href} className="sub link">
                {crossLink.label} &rarr;
              </a>
            )}

            {user.bio && <span className="sub">{user.bio}</span>}
          </div>
        </section>
      )}

      <section className="stats">
        {statKeys.map((key) => (
          <Stat key={key} k={STAT_LABELS[key]} {...statValue(key, stats, agents, hasUsage, plans)} />
        ))}
      </section>

      {!hasUsage ? (
        empty
      ) : (
        <>
          {showActivity && (
            <section>
              <Heatmap
                round
                by={heatBy}
                days={stats.byDay.map((point) => ({
                  day: point.day,
                  cost: point.cost,
                  requests: point.requests,
                  tokens: point.tokens,
                }))}
              />
            </section>
          )}

          <TokenTrend total={stats.totals.tokens} points={denseTokens(stats)} />

          <Facts stats={stats} agents={agents} eaonRank={eaonRank} eaonBoardHref={eaonBoardHref} />
        </>
      )}
    </>
  );
}

/* ----------------------------------------------------------------- facts */

/**
 * The second row: smaller figures that answer the next question after the
 * headline — what it cost, how often, on what — and the top models as
 * hairlines. Drawn quieter than the stats above so the two rows do not
 * compete.
 */
function Facts({
  stats,
  agents,
  eaonRank,
  eaonBoardHref,
}: {
  stats: UserStats;
  agents: AgentSummary;
  eaonRank: number | null;
  eaonBoardHref: string;
}) {
  const byTokens = [...stats.byModel].sort((a, b) => b.tokens - a.tokens);
  const favourite = byTokens[0];
  const busiest = stats.byDay.reduce<UserStats["byDay"][number] | null>(
    (top, point) => (top === null || point.tokens > top.tokens ? point : top),
    null,
  );

  const facts: { k: string; v: React.ReactNode }[] = [
    { k: "spend", v: money(stats.totals.cost, 2) },
    { k: "active days", v: count(stats.totals.days) },
  ];
  if (agents.runs > 0) {
    facts.push({ k: "agent time", v: duration(agents.totalMs) });
    facts.push({ k: "average agent", v: duration(agents.totalMs / agents.runs) });
  }
  if (favourite) facts.push({ k: "favourite model", v: modelLabel(favourite.model) });
  if (busiest && busiest.tokens > 0) {
    facts.push({ k: "busiest day", v: `${compact(busiest.tokens)} · ${shortDay(busiest.day)}` });
  }
  if (eaonRank) {
    facts.push({
      k: "eaon board",
      v: (
        <Link href={eaonBoardHref} className="link">
          #{eaonRank}
        </Link>
      ),
    });
  }

  const top = byTokens.slice(0, 5);

  return (
    <section className="facts-wrap">
      <dl className="facts">
        {facts.map((fact) => (
          <div key={fact.k}>
            <dt>{fact.k}</dt>
            <dd>{fact.v}</dd>
          </div>
        ))}
      </dl>

      {top.length > 0 && (
        <div>
          <p className="block-label" style={{ marginBottom: "0.85rem" }}>
            top models
          </p>
          <ShareBars
            total={stats.totals.tokens}
            rows={top.map((point) => ({
              label: modelLabel(point.model),
              value: point.tokens,
              display: `${compact(point.tokens)} · ${percent(point.tokens, stats.totals.tokens)}`,
            }))}
          />
        </div>
      )}
    </section>
  );
}

/* ----------------------------------------------------------------- stats */

function Stat({ k, v, idle }: { k: string; v: string; idle?: boolean }) {
  return (
    <div className="stat">
      <span className="k">{k}</span>
      <span className={`v${idle ? " idle" : ""}`}>{v}</span>
    </div>
  );
}

/** One headline figure. */
function statValue(
  key: StatKey,
  stats: UserStats,
  agents: AgentSummary,
  hasUsage: boolean,
  plans: Plan[],
): { v: string; idle?: boolean } {
  const dash = { v: "—", idle: true };

  // Agent figures stand on their own rows: an app can report runs on a day it
  // reported no tokens, and "0m" is a true answer where a dash is not.
  if (key === "agents") return { v: count(agents.runs), idle: agents.runs === 0 };
  if (key === "longestAgent") return { v: duration(agents.longestMs), idle: agents.longestMs === 0 };

  if (!hasUsage && key !== "streak" && key !== "longestStreak") return dash;

  switch (key) {
    case "spend":
      return { v: money(stats.totals.cost, 2) };
    case "tokens":
      return { v: compact(stats.totals.tokens) };
    case "requests":
      return { v: count(stats.totals.requests) };
    case "activeDays":
      return { v: count(stats.totals.days) };
    case "streak":
      return { v: `${stats.streak}d`, idle: stats.streak === 0 };
    case "longestStreak":
      return { v: `${stats.longestStreak}d`, idle: stats.longestStreak === 0 };
    case "models":
      return { v: String(stats.byModel.length) };
    case "tools":
      return { v: String(stats.byTool.length) };
    case "perDay":
      return { v: money(stats.totals.cost / Math.max(stats.totals.days, 1), 2) };
    case "perRequest":
      return { v: money(stats.totals.cost / Math.max(stats.totals.requests, 1)) };
    case "biggestDay":
      return stats.best ? { v: money(stats.best.cost, 2) } : dash;
    case "planRoi": {
      // A dash rather than a zero when there is nothing to compare against: an
      // account with no priced subscription has no return, which is a
      // different statement from a return of nothing.
      const flat = subscriptionMonthly(plans);
      const measured = spendSince(stats, 30);
      if (flat <= 0 || measured <= 0) return dash;
      return { v: `${(measured / flat).toFixed(1)}×` };
    }
  }
}

/* --------------------------------------------------------------- helpers */

/** A year of daily tokens ending today, with the quiet days filled in. */
function denseTokens(stats: UserStats): { day: string; value: number }[] {
  const byDay = new Map(stats.byDay.map((point) => [point.day, point.tokens]));
  const end = today();
  const start = shiftDay(end, -(TREND_DAYS - 1));
  return Array.from({ length: TREND_DAYS }, (_, index) => {
    const day = shiftDay(start, index);
    return { day, value: byDay.get(day) ?? 0 };
  });
}

/** Total spend over the last `days` calendar days, ending today. */
export function spendSince(stats: UserStats, days: number): number {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
  const from = cutoff.toISOString().slice(0, 10);

  return stats.byDay.reduce((sum, point) => (point.day >= from ? sum + point.cost : sum), 0);
}

/** "148 days ago", the way a profile reads it. */
function sinceJoin(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "recently";

  const days = Math.max(0, Math.floor((Date.now() - then) / 86_400_000));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}
