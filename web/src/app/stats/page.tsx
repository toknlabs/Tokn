import type { Metadata } from "next";
import Link from "next/link";
import { AreaChart, ShareBars } from "@/components/Charts";
import { Avatar } from "@/components/Avatar";
import { ModelMix } from "@/components/ModelMix";
import { ToolLogo } from "@/components/BrandLogo";
import { Ticker, type TickerFormat } from "@/components/Ticker";
import { compact, count, money, niceDay, relative } from "@/lib/format";
import { resolveModelLogos } from "@/lib/logos-server";
import { siteStats } from "@/lib/site-stats";
import { leaderboard } from "@/lib/stats";

/**
 * Site-wide statistics.
 *
 * The leaderboard answers "who"; this page answers "how much, of what, and
 * when". A rolling 30-day window is the headline, with all-time beside it for
 * scale — a stat with no period attached is not a stat.
 */

/**
 * Dynamic, and unavoidably so: the root layout calls `currentUser()`, which
 * reads cookies, and that makes every route under it render per request. A
 * page-level `revalidate` here is silently ignored — the route never reaches
 * the prerender manifest.
 *
 * The expensive part is cached one level down instead. `siteStats` memoises
 * its own result, so the full scan of `usage_daily` runs once per window
 * rather than once per visitor.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "stats — tokn" };

/**
 * Tokens are an abstract unit, so the headline gets two anchors: a rate, and a
 * comparison to something with a size people already know. A novel runs around
 * 120k tokens.
 */
const TOKENS_PER_NOVEL = 120_000;
const WINDOW_DAYS = 30;

export default async function StatsPage() {
  const stats = await siteStats(WINDOW_DAYS);
  const month = await leaderboard("month", "cost", 10, { activeOnly: true });
  const modelLogos = await resolveModelLogos(stats.byModel.map((model) => model.model));

  const seconds = WINDOW_DAYS * 86_400;
  const perSecond = stats.window.tokens / seconds;
  const novels = stats.window.tokens / TOKENS_PER_NOVEL;
  const busiest = [...stats.byDay].sort((a, b) => b.cost - a.cost)[0];

  return (
    <>
      <section>
        <h1 className="title">stats</h1>
        <p className="lede" style={{ marginTop: "0.5rem" }}>
          everything the board knows, measured over the last {WINDOW_DAYS} days.
          all figures come from real sessions scanned by the cli.
        </p>
      </section>

      <section className="stats">
        <Cell
          label="developers"
          value={stats.users.total}
          format="count"
          foot={
            stats.users.joinedThisWeek > 0
              ? `+${stats.users.joinedThisWeek} this week`
              : `${stats.users.reporting} reporting`
          }
        />
        <Cell
          label={`tokens · ${WINDOW_DAYS}d`}
          value={stats.window.tokens}
          format="compact"
          foot={`≈ ${compact(novels)} novels · ${compact(perSecond)}/sec`}
        />
        <Cell
          label={`spend · ${WINDOW_DAYS}d`}
          value={stats.window.cost}
          format="usd0"
          foot={`${money(stats.allTime.cost, 0)} all time`}
        />
        <Cell
          label={`requests · ${WINDOW_DAYS}d`}
          value={stats.window.requests}
          format="compact"
          foot={`${stats.users.activeInWindow} developers active`}
        />
      </section>

      <section>
        <p className="block-label">spend · last {WINDOW_DAYS} days</p>
        <p className="block-value">{money(stats.window.cost, 2)}</p>
        <div style={{ marginTop: "1.25rem" }}>
          <AreaChart
            points={stats.byDay.map((point) => ({
              day: point.day,
              value: point.cost,
            }))}
            format={(value) => money(value, 2)}
          />
        </div>
        <div className="axis">
          <span>{stats.byDay[0] ? niceDay(stats.byDay[0].day) : ""}</span>
          <span>
            {busiest && busiest.cost > 0
              ? `busiest ${niceDay(busiest.day)} · ${money(busiest.cost, 2)}`
              : ""}
          </span>
          <span>today</span>
        </div>
      </section>

      <ModelMix models={stats.byModel} windowDays={WINDOW_DAYS} logoMap={modelLogos} />

      <div className="split">
        <section>
          <p className="block-label">tools</p>
          <p className="block-value">
            {stats.byTool.length} {stats.byTool.length === 1 ? "tool" : "tools"}
          </p>
          <div style={{ marginTop: "1.25rem" }}>
            {stats.byTool.length === 0 ? (
              <p className="micro">nothing reported in this window</p>
            ) : (
              <ShareBars
                rows={stats.byTool.map((point) => ({
                  key: point.tool,
                  label: point.tool,
                  value: point.cost,
                  display: `${money(point.cost, 2)} · ${point.users} ${
                    point.users === 1 ? "dev" : "devs"
                  }`,
                  icon: <ToolLogo tool={point.tool} />,
                }))}
              />
            )}
          </div>
        </section>
      </div>

      <section>
        <p className="block-label">records · last {WINDOW_DAYS} days</p>
        <div className="stats" style={{ marginTop: "1rem" }}>
          <Record
            k="biggest day"
            handle={stats.records.biggestDay?.handle}
            v={
              stats.records.biggestDay
                ? money(stats.records.biggestDay.value, 2)
                : "—"
            }
            foot={
              stats.records.biggestDay?.detail
                ? niceDay(stats.records.biggestDay.detail)
                : undefined
            }
          />
          <Record
            k="most requests"
            handle={stats.records.mostRequests?.handle}
            v={
              stats.records.mostRequests
                ? count(stats.records.mostRequests.value)
                : "—"
            }
          />
          <Record
            k="most models"
            handle={stats.records.mostModels?.handle}
            v={
              stats.records.mostModels
                ? String(stats.records.mostModels.value)
                : "—"
            }
          />
        </div>
      </section>

      <div className="split">
        <section>
          <p className="block-label">top this month</p>
          <div className="table-wrap" style={{ marginTop: "1rem" }}>
            <table className="t">
              <thead>
                <tr>
                  <th style={{ width: "2.5rem" }}>#</th>
                  <th>user</th>
                  <th className="r">spend</th>
                  <th className="r">tokens</th>
                </tr>
              </thead>
              <tbody>
                {month.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="sub">
                      nothing reported this month yet
                    </td>
                  </tr>
                ) : (
                  month.map((entry, index) => (
                    <tr
                      key={entry.userId}
                      className="rise"
                      style={{ "--i": index } as React.CSSProperties}
                    >
                      <td className="rank">{entry.rank}</td>
                      <td>
                        <Link
                          href={`/profile/${entry.handle}`}
                          className="link"
                        >
                          {entry.handle}
                        </Link>
                      </td>
                      <td className="r">{money(entry.cost, 2)}</td>
                      <td className="r sub">{compact(entry.tokens)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <p className="block-label">latest syncs</p>
          <ul style={{ listStyle: "none", padding: 0, marginTop: "1rem" }}>
            {stats.recentSyncs.length === 0 ? (
              <li className="micro">no machines have reported yet</li>
            ) : (
              stats.recentSyncs.map((sync, index) => (
                <li
                  key={sync.handle}
                  className="sync rise"
                  style={{ "--i": index } as React.CSSProperties}
                >
                  <Avatar handle={sync.handle} size={20} />
                  <Link href={`/profile/${sync.handle}`} className="link">
                    {sync.handle}
                  </Link>
                  <span className="sub" style={{ marginLeft: "auto" }}>
                    {relative(sync.at)}
                  </span>
                </li>
              ))
            )}
          </ul>
        </section>
      </div>

      <section>
        <p className="micro">
          the window is a rolling {WINDOW_DAYS} days.{" "}
          {stats.allTime.firstDay
            ? `the board has been collecting since ${niceDay(stats.allTime.firstDay)}, `
            : ""}
          {compact(stats.allTime.tokens)} tokens and{" "}
          {money(stats.allTime.cost, 0)} in total.
        </p>
      </section>
    </>
  );
}

/* ---------------------------------------------------------------- pieces */

function Cell({
  label,
  value,
  format,
  foot,
}: {
  label: string;
  value: number;
  format: TickerFormat;
  foot: string;
}) {
  return (
    <div className="stat">
      <span className="k">{label}</span>
      <span className="v">
        <Ticker value={value} format={format} />
      </span>
      <span
        className="k"
        style={{ marginTop: "0.2rem", fontSize: "0.6875rem" }}
      >
        {foot}
      </span>
    </div>
  );
}

function Record({
  k,
  handle,
  v,
  foot,
}: {
  k: string;
  handle?: string;
  v: string;
  foot?: string;
}) {
  return (
    <div className="stat">
      <span className="k">{k}</span>
      <span className="v">{v}</span>
      <span
        className="k"
        style={{ marginTop: "0.2rem", fontSize: "0.6875rem" }}
      >
        {handle ? (
          <Link href={`/profile/${handle}`} className="link">
            {handle}
          </Link>
        ) : (
          "—"
        )}
        {foot ? ` · ${foot}` : ""}
      </span>
    </div>
  );
}
