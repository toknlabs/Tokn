import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { ShareButton } from "@/components/ShareButton";
import { SocialIcon } from "@/components/SocialIcon";
import { Bars, DailyBars, KindSplit, Ranked, YearGrid } from "@/components/eaon/charts";
import { Card, Facts, Stat, change, pairCards, pct } from "@/components/eaon/parts";
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
 * Desktop reported. One figure and its days at the top, the year as
 * squares, then the details, each shown once there is enough behind it.
 *
 * Visibility is the tokn profile's, unchanged: a private profile is a 404 to
 * everyone but its owner and their friends.
 */

export const dynamic = "force-dynamic";

type Params = Promise<{ handle: string }>;

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const { handle } = await params;
  const user = await findUserByHandle(decodeURIComponent(handle));
  if (!user || !user.isPublic) return { title: "Not found · tokns" };
  const name = user.name?.trim() || user.handle;
  const stats = await userStats(user.id, "all", { tool: EAON_TOOL });
  const title = `${name} (@${user.handle}) on Eaon`;
  const description =
    stats.totals.tokens > 0
      ? `${compact(stats.totals.tokens)} tokens through Eaon Desktop.`
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

export default async function EaonProfilePage({ params }: { params: Params }) {
  const { handle } = await params;
  const user = await findUserByHandle(decodeURIComponent(handle));
  if (!user) notFound();

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

  const now = today();
  const byDay = new Map(stats.byDay.map((point) => [point.day, point.tokens]));
  const runsByDay = new Map(agents.byDay.map((point) => [point.day, point.runs]));
  // The chart starts at their first day, between two weeks and 90 days back,
  // so someone new doesn't get a chart that is nearly all empty.
  const sinceFirst = stats.firstDay
    ? Math.round(
        (Date.parse(`${now}T00:00:00Z`) - Date.parse(`${stats.firstDay}T00:00:00Z`)) / 86_400_000,
      ) + 3
    : 14;
  const span = Math.min(90, Math.max(14, sinceFirst));
  const last90: string[] = [];
  for (let day = shiftDay(now, -(span - 1)); day <= now; day = shiftDay(day, 1)) last90.push(day);

  const joinedDays = Math.max(
    0,
    Math.round((Date.now() - Date.parse(user.created_at)) / 86_400_000),
  );
  const empty = stats.totals.tokens === 0 && agents.runs === 0;
  const busiest = person.weekdays.reduce(
    (best, day, i, all) => (day.tokens > (all[best]?.tokens ?? 0) ? i : best),
    0,
  );
  const top = person.percentiles;
  const bestDay = stats.byDay.reduce<(typeof stats.byDay)[number] | null>(
    (a, b) => (!a || b.tokens > a.tokens ? b : a),
    null,
  );

  return (
    <div className="e-page">
      <section className="e-person">
        <Avatar handle={user.handle} size={64} style={prefs.avatar} url={user.avatarUrl ?? null} />
        <div className="e-person-who">
          <h1>{name}</h1>
          <p className="e-person-line">
            <span>@{user.handle}</span>
            {person.rank && (
              <Link href={paths.board} className="e-pill">
                #{person.rank} on the board
              </Link>
            )}
            {!user.isPublic && <span className="e-pill">Private</span>}
          </p>
          {user.bio && <p className="e-person-bio">{user.bio}</p>}
          <p className="e-person-meta">
            <span>Joined {plural(joinedDays, "day")} ago</span>
            {links.map((link) => (
              <a key={link.url} href={link.url} target="_blank" rel="me noreferrer noopener">
                <SocialIcon provider={link.provider} size={12} />
                {link.label}
              </a>
            ))}
          </p>
        </div>
        <div className="e-person-actions">
          <ShareButton
            handle={user.handle}
            path={site === "eaon" ? `/@${user.handle}` : `${EAON_URL}/@${user.handle}`}
          />
          <a href={toknProfileHref(user.handle, site)} className="e-button">
            Tokn profile
          </a>
        </div>
      </section>

      {empty ? (
        <p className="e-empty">
          {own
            ? "Nothing from Eaon Desktop yet. Sign in with Tokn in the app and it syncs by itself."
            : "No Eaon Desktop usage yet."}
        </p>
      ) : (
        <>
          <section className="e-hero e-hero-person">
            <p className="e-eyebrow">Through Eaon Desktop · all time</p>
            <h2 className="e-big">
              {compact(stats.totals.tokens)}
              <span className="e-big-unit">tokens</span>
              {person.momentum !== null && change(1 + person.momentum, 1) && (
                <span
                  className="e-delta e-delta-big"
                  data-up={person.momentum >= 0}
                  title="The last 7 days against the 7 before"
                >
                  {change(1 + person.momentum, 1)!.text} this week
                </span>
              )}
            </h2>
            <p className="e-lede">
              {plural(stats.totals.requests, "request")} on {plural(stats.totals.days, "day")},{" "}
              {pct(person.cacheHit, 0)} of prompts served from cache
              {bestDay
                ? `, ${compact(bestDay.tokens)} on the biggest day (${niceDay(bestDay.day)})`
                : ""}
              .
            </p>
            <DailyBars days={last90.map((day) => ({ day, value: byDay.get(day) ?? 0 }))} />
          </section>

          <dl className="e-stats">
            <Stat
              label="Current streak"
              value={`${stats.streak}d`}
              note={`Longest ${stats.longestStreak}d`}
            />
            <Stat
              label="Agent runs"
              value={agents.runs > 0 ? count(agents.runs) : "—"}
              note={agents.runs > 0 ? `Longest ${duration(agents.longestMs)}` : "None synced yet"}
            />
            <Stat
              label="Cache hit rate"
              value={pct(person.cacheHit)}
              note="Prompt tokens from cache"
            />
            <Stat
              label="Spend at API prices"
              value={money(stats.totals.cost, stats.totals.cost < 100 ? 2 : 0)}
              note={`${money(person.costPerMillion)} per 1M tokens`}
            />
          </dl>

          <section className="e-section">
            <header className="e-section-head">
              <h2>The last year</h2>
              <span className="e-section-note">{plural(stats.totals.days, "active day")}</span>
            </header>
            <YearGrid
              values={new Map(stats.byDay.map((point) => [point.day, point.tokens]))}
              end={now}
            />
          </section>

          <section className="e-section">
            <header className="e-section-head">
              <h2>Under the hood</h2>
            </header>
            <div className="e-cards">
              {pairCards(
                [
                  <Card key="kinds" title="What the tokens were" note="By kind" wide>
                    <KindSplit kinds={person.kinds} />
                    <Facts
                      items={[
                        ["Output share", pct(person.outputShare, 2)],
                        ["Per request", compact(person.tokensPerRequest)],
                        ["Models in effect", `${(2 ** person.modelBits).toFixed(1)}`],
                        ["Entropy", `${person.modelBits.toFixed(2)} bits`],
                      ]}
                    />
                  </Card>,
                  <Card key="models" title="Models" note={plural(stats.byModel.length, "model")}>
                    <Ranked
                      items={[...stats.byModel]
                        .sort((a, b) => b.tokens - a.tokens)
                        .slice(0, 5)
                        .map((model) => ({
                          label: model.model,
                          value: model.tokens,
                          sub: `${makerOf(model.model)} · ${money(model.cost, 2)}`,
                        }))}
                    />
                  </Card>,
                  stats.totals.days >= 7 && (
                    <Card key="week" title="The week" note={`Busiest: ${WEEKDAYS[busiest]}`}>
                      <Bars
                        values={person.weekdays.map((day) => day.tokens)}
                        labels={WEEKDAYS}
                        unit=" tokens"
                      />
                    </Card>
                  ),
                  agents.runs > 0 && (
                    <Card key="agents" title="Agents" note={`Last ${span} days`}>
                      <DailyBars
                        days={last90.map((day) => ({ day, value: runsByDay.get(day) ?? 0 }))}
                        height={90}
                        unit="runs"
                        format={count}
                      />
                      <Facts
                        items={[
                          ["Runs", count(agents.runs)],
                          ["Average", duration(agents.totalMs / agents.runs)],
                          ["Longest", duration(agents.longestMs)],
                          [
                            "Most in a day",
                            person.maxRunsDay ? count(person.maxRunsDay.runs) : "—",
                          ],
                        ]}
                      />
                    </Card>
                  ),
                  top && person.ranked >= 5 && (
                    <Card key="versus" title="Against everyone" note="Share of developers behind">
                      <ul className="e-versus">
                        {(
                          [
                            ["Tokens", top.tokens],
                            ["Agent runs", top.runs],
                            ["Agent time", top.agentMs],
                            ["Streak", top.streak],
                          ] as const
                        ).map(([label, value]) => (
                          <li key={label}>
                            <span>{label}</span>
                            <span className="e-versus-track">
                              <i style={{ width: `${Math.max(2, value * 100)}%` }} />
                            </span>
                            <span>{pct(value, 0)}</span>
                          </li>
                        ))}
                      </ul>
                    </Card>
                  ),
                ].filter((card): card is React.ReactElement<{ wide?: boolean }> => Boolean(card)),
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
