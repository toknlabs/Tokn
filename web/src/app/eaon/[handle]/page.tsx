import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { ShareButton } from "@/components/ShareButton";
import { SocialIcon } from "@/components/SocialIcon";
import { Bars, DayBars, KindSplit, Ranked, Ring, StackedArea, YearGrid } from "@/components/eaon/charts";
import { Fact, Kpi, PanelHead, change, pct } from "@/components/eaon/parts";
import { currentUser, findUserByHandle } from "@/lib/auth";
import { areFriends } from "@/lib/backend";
import { eaonPerson, makerOf } from "@/lib/eaon";
import { compact, count, duration, money, niceDay } from "@/lib/format";
import { parseLinks } from "@/lib/links";
import { parsePrefs } from "@/lib/prefs";
import { EAON_TOOL, shiftDay, today, userStats } from "@/lib/stats";
import { EAON_URL, currentSite, eaonPaths, eaonProfileUrl, toknProfileHref } from "@/lib/sites";

/**
 * Someone's Eaon Desktop profile, tokns.eaon.dev/@handle: only what Eaon
 * Desktop reported, as every figure we can honestly make of it. Their full
 * tokn profile, with every tool, is a link away on toknhq.com.
 *
 * Visibility is the tokn profile's, unchanged. Sessions live on toknhq.com,
 * so on the Eaon host nobody is signed in and a private profile is simply not
 * found, the same answer a stranger gets there.
 */

export const dynamic = "force-dynamic";

type Params = Promise<{ handle: string }>;

const RANGES = [
  { key: "30", label: "30d", days: 30 },
  { key: "90", label: "90d", days: 90 },
  { key: "365", label: "1y", days: 365 },
] as const;
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { handle } = await params;
  const user = await findUserByHandle(decodeURIComponent(handle));
  if (!user || !user.isPublic) return { title: "not found · tokns" };
  const name = user.name?.trim() || user.handle;
  const stats = await userStats(user.id, "all", { tool: EAON_TOOL });
  const title = `${name} (@${user.handle}) on Eaon`;
  const description =
    stats.totals.tokens > 0
      ? `${compact(stats.totals.tokens)} tokens through Eaon Desktop: agents, streaks, cache hit rate and the rest.`
      : `${name}'s Eaon Desktop profile.`;
  const url = eaonProfileUrl(user.handle);
  return {
    title: `${title} · tokns`,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: "Eaon", type: "profile" },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function EaonProfilePage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: Promise<{ range?: string }>;
}) {
  const { handle } = await params;
  const query = await searchParams;
  const user = await findUserByHandle(decodeURIComponent(handle));
  if (!user) notFound();

  // The same rule as /profile/[handle]: private is a 404 to everyone but the
  // owner and accepted friends, so the handle's existence is not confirmed.
  const me = await currentUser();
  const own = me?.id === user.id;
  const friend = !own && me ? await areFriends(me.id, user.id) : false;
  if (!user.isPublic && !own && !friend) notFound();

  const site = await currentSite();
  const paths = eaonPaths(site);
  const person = await eaonPerson(user.id);
  const { stats, agents } = person;
  const prefs = parsePrefs(user.prefs);
  const links = parseLinks(user.links);
  const name = user.name?.trim() || user.handle;
  const range = RANGES.find((entry) => entry.key === query.range) ?? RANGES[1];
  const self = paths.profile(user.handle);

  const now = today();
  const byDay = new Map(stats.byDay.map((point) => [point.day, point]));
  const runsByDay = new Map(agents.byDay.map((point) => [point.day, point.runs]));
  const rangeDays: { day: string; input: number; output: number; cacheRead: number; cacheWrite: number }[] = [];
  for (let day = shiftDay(now, -(range.days - 1)); day <= now; day = shiftDay(day, 1)) {
    const point = byDay.get(day);
    rangeDays.push({ day, input: point?.input ?? 0, output: point?.output ?? 0, cacheRead: point?.cacheRead ?? 0, cacheWrite: point?.cacheWrite ?? 0 });
  }
  const runDays: string[] = [];
  for (let day = shiftDay(now, -89); day <= now; day = shiftDay(day, 1)) runDays.push(day);

  const joinedDays = Math.max(0, Math.round((Date.now() - Date.parse(user.created_at)) / 86_400_000));
  const avgRun = agents.runs > 0 ? agents.totalMs / agents.runs : 0;
  const busiest = person.weekdays.reduce((best, day, i, all) => (day.tokens > (all[best]?.tokens ?? 0) ? i : best), 0);
  const empty = stats.totals.tokens === 0 && agents.runs === 0;
  const top = person.percentiles;

  return (
    <div className="e-page">
      <section className="e-profile">
        <Avatar handle={user.handle} size={72} style={prefs.avatar} url={user.avatarUrl ?? null} />
        <div className="e-profile-who">
          <p className="e-kicker">eaon_desktop.profile</p>
          <h1 className="e-profile-name">{name}</h1>
          <div className="e-profile-line">
            <span className="e-handle">@{user.handle}</span>
            {person.rank && (
              <Link href={paths.board} className="e-badge" data-tone="blue">
                #{person.rank} of {count(person.ranked)}
              </Link>
            )}
            {top && stats.totals.tokens > 0 && (
              <span className="e-badge">{top.tokens >= 1 ? "ahead of everyone by tokens" : `ahead of ${pct(top.tokens, 0)} by tokens`}</span>
            )}
            {!user.isPublic && <span className="e-badge">private</span>}
          </div>
          {user.bio && <p className="e-bio">{user.bio}</p>}
          <div className="e-profile-meta">
            <span>joined {count(joinedDays)} days ago</span>
            {stats.firstDay && <span>first Eaon day {niceDay(stats.firstDay)}</span>}
            {links.map((link) => (
              <a key={link.url} href={link.url} target="_blank" rel="me noreferrer noopener">
                <SocialIcon provider={link.provider} size={12} />
                {link.label}
              </a>
            ))}
          </div>
        </div>
        <div className="e-profile-actions">
          <ShareButton handle={user.handle} path={site === "eaon" ? `/@${user.handle}` : `${EAON_URL}/@${user.handle}`} />
          <a href={toknProfileHref(user.handle, site)} className="e-ghost">
            Full profile on Tokn ↗
          </a>
        </div>
      </section>

      {empty ? (
        <section className="e-panel">
          <p className="e-empty">
            {own
              ? "Nothing from Eaon Desktop yet. Sign in with Tokn in the app and it syncs by itself."
              : "No Eaon Desktop usage reported yet."}
          </p>
        </section>
      ) : (
        <>
          <section className="e-kpis">
            <Kpi k="tokens" v={compact(stats.totals.tokens)} delta={person.momentum === null ? null : change(1 + person.momentum, 1)} foot="all time · Δ last 7 days vs the 7 before" />
            <Kpi k="requests" v={compact(stats.totals.requests)} foot={`${compact(person.tokensPerRequest)} tokens each`} />
            <Kpi k="streak" v={`${stats.streak}d`} foot={`longest ${stats.longestStreak}d`} />
            <Kpi k="active_days" v={count(stats.totals.days)} foot={joinedDays > 0 ? `${pct(Math.min(1, stats.totals.days / Math.max(1, joinedDays)), 0)} of days since joining` : undefined} />
            <Kpi k="agent_runs" v={count(agents.runs)} foot={agents.activeDays > 0 ? `${(agents.runs / agents.activeDays).toFixed(1)} per active day` : undefined} />
            <Kpi k="agent_time" v={duration(agents.totalMs)} foot={`avg ${duration(avgRun)} a run`} />
            <Kpi k="longest_agent" v={duration(agents.longestMs)} foot={person.maxRunsDay ? `most in a day: ${person.maxRunsDay.runs}` : undefined} />
            <Kpi k="cache.hit_rate" v={pct(person.cacheHit)} foot="of prompt tokens" />
            <Kpi k="output.share" v={pct(person.outputShare, 2)} foot="tokens the models wrote" />
            <Kpi k="model.entropy" v={`${person.modelBits.toFixed(2)} bits`} foot={`≈ ${(2 ** person.modelBits).toFixed(1)} models in effect · ${stats.byModel.length} used`} />
            <Kpi k="spend.equiv" v={money(stats.totals.cost, 0)} foot={`${money(person.costPerMillion)} per 1M tokens`} />
            <Kpi k="peak_day" v={WEEKDAYS[busiest] ?? "—"} foot={`weekends ${pct(person.weekendShare, 0)} of tokens`} />
          </section>

          <section className="e-panel">
            <PanelHead k="activity.year" title="The last year" note={`${count(stats.totals.days)} active days`} />
            <YearGrid values={new Map(stats.byDay.map((point) => [point.day, point.tokens]))} end={now} />
          </section>

          <section className="e-panel">
            <div className="e-board-head">
              <PanelHead k="tokens.by_kind" title="Tokens per day" />
              <nav className="e-seg e-seg-sm" aria-label="range">
                {RANGES.map((entry) => (
                  <Link key={entry.key} href={`${self}?range=${entry.key}`} data-on={entry.key === range.key || undefined} scroll={false}>
                    {entry.label}
                  </Link>
                ))}
              </nav>
            </div>
            <StackedArea days={rangeDays} height={220} />
            <KindSplit kinds={person.kinds} />
          </section>

          <div className="e-grid e-grid-3">
            <section className="e-panel e-center">
              <PanelHead k="cache.hit_rate" title="Cache" />
              <Ring value={person.cacheHit} label="hit rate" size={136} />
              <dl className="e-facts">
                <Fact k="read from cache" v={compact(person.kinds.cacheRead)} />
                <Fact k="fresh input" v={compact(person.kinds.input)} />
              </dl>
            </section>
            <section className="e-panel">
              <PanelHead k="model.share" title="Models" note={`${stats.byModel.length} used`} />
              <Ranked
                items={[...stats.byModel]
                  .sort((a, b) => b.tokens - a.tokens)
                  .slice(0, 6)
                  .map((model) => ({ label: model.model, value: model.tokens, sub: `${makerOf(model.model)} · ${money(model.cost)}` }))}
              />
            </section>
            <section className="e-panel">
              <PanelHead k="load.by_weekday" title="When they work" note={`peak: ${WEEKDAYS[busiest]}`} />
              <Bars values={person.weekdays.map((day) => day.tokens)} labels={WEEKDAYS} unit=" tokens" height={150} />
            </section>
          </div>

          <div className="e-grid e-grid-2">
            <section className="e-panel">
              <PanelHead k="agents.per_day" title="Agent runs, last 90 days" note={`${count(agents.runs)} all time`} />
              <DayBars values={runDays.map((day) => runsByDay.get(day) ?? 0)} days={runDays} height={110} label="agent runs per day" />
              <dl className="e-facts e-facts-4">
                <Fact k="runs" v={count(agents.runs)} />
                <Fact k="avg run" v={duration(avgRun)} />
                <Fact k="longest" v={duration(agents.longestMs)} />
                <Fact k="days with agents" v={count(agents.activeDays)} />
              </dl>
            </section>
            <section className="e-panel">
              <PanelHead k="vs.everyone" title="Against everyone on Eaon" note={top ? "share of developers behind" : undefined} />
              {top ? (
                <ul className="e-vs">
                  {(
                    [
                      ["tokens", top.tokens],
                      ["agent runs", top.runs],
                      ["agent time", top.agentMs],
                      ["current streak", top.streak],
                    ] as const
                  ).map(([label, value]) => (
                    <li key={label}>
                      <span className="e-vs-label">{label}</span>
                      <span className="e-vs-track">
                        <span style={{ width: `${Math.max(2, value * 100)}%` }} />
                      </span>
                      <span className="e-vs-value">ahead of {pct(value, 0)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="e-empty">Not enough people on the board yet to compare.</p>
              )}
            </section>
          </div>

          <section>
            <h2 className="e-h2">
              <span className="e-k">records</span> Personal bests
            </h2>
            <div className="e-records">
              {stats.best && (
                <div className="e-record">
                  <span className="e-k">biggest day</span>
                  <span className="e-record-v">{compact(Math.max(...stats.byDay.map((point) => point.tokens)))} tokens</span>
                  <span className="e-record-who e-dim">
                    {niceDay(stats.byDay.reduce((a, b) => (b.tokens > a.tokens ? b : a)).day)}
                  </span>
                </div>
              )}
              <div className="e-record">
                <span className="e-k">longest agent run</span>
                <span className="e-record-v">{duration(agents.longestMs)}</span>
              </div>
              {person.maxRunsDay && (
                <div className="e-record">
                  <span className="e-k">most agents in a day</span>
                  <span className="e-record-v">{count(person.maxRunsDay.runs)} runs</span>
                  <span className="e-record-who e-dim">{niceDay(person.maxRunsDay.day)}</span>
                </div>
              )}
              <div className="e-record">
                <span className="e-k">longest streak</span>
                <span className="e-record-v">{count(stats.longestStreak)} days</span>
              </div>
            </div>
          </section>
        </>
      )}

      <p className="e-cta">
        <Link href={paths.board} className="e-link">
          ← Back to the Eaon usage index
        </Link>
      </p>
    </div>
  );
}
