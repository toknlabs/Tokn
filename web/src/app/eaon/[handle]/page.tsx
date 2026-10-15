import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { ShareButton } from "@/components/ShareButton";
import { SocialIcon } from "@/components/SocialIcon";
import { DailyBars, KINDS, YearGrid } from "@/components/eaon/charts";
import { Group, change, pct, type Row } from "@/components/eaon/parts";
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
 * Desktop reported. Who they are, one figure and its days, the year as
 * squares, then the details as plain lists, each shown once there is enough
 * behind it.
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

  const total = Math.max(1, person.kinds.cacheRead + person.kinds.cacheWrite + person.kinds.input + person.kinds.output);
  const kinds: Row[] = KINDS.map((kind) => ({
    label: kind.label,
    value: (
      <>
        {compact(person.kinds[kind.key])}
        <span>{pct(person.kinds[kind.key] / total)}</span>
      </>
    ),
  }));
  kinds.push(
    { label: "Per request", value: compact(person.tokensPerRequest) },
    { label: "Spend at API prices", value: money(stats.totals.cost, stats.totals.cost < 100 ? 2 : 0) },
  );
  const models: Row[] = [...stats.byModel]
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 5)
    .map((model) => ({
      key: model.model,
      label: model.model,
      sub: makerOf(model.model),
      value: compact(model.tokens),
    }));
  const agentRows: Row[] =
    agents.runs > 0
      ? [
          { label: "Runs", value: count(agents.runs) },
          { label: "Average run", value: duration(agents.totalMs / agents.runs) },
          { label: "Longest run", value: duration(agents.longestMs) },
          { label: "Most in a day", value: person.maxRunsDay ? count(person.maxRunsDay.runs) : "—" },
        ]
      : [];
  const versus: Row[] =
    top && person.ranked >= 5
      ? (
          [
            ["Tokens", top.tokens],
            ["Agent runs", top.runs],
            ["Agent time", top.agentMs],
            ["Streak", top.streak],
          ] as const
        ).map(([label, value]) => ({ label, value: `Ahead of ${pct(value, 0)}` }))
      : [];
  const momentum = person.momentum !== null ? change(1 + person.momentum, 1) : null;

  return (
    <div className="e-page">
      <section className="e-person">
        <Avatar handle={user.handle} size={56} style={prefs.avatar} url={user.avatarUrl ?? null} />
        <div className="e-person-who">
          <h1>{name}</h1>
          <p className="e-person-line">
            @{user.handle}
            {person.rank && (
              <>
                {" · "}
                <Link href={paths.board}>#{person.rank} on the board</Link>
              </>
            )}
            {!user.isPublic && " · Private"}
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
          <a href={toknProfileHref(user.handle, site)}>Tokn profile</a>
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
          <section className="e-hero">
            <p className="e-eyebrow">Through Eaon Desktop, all time</p>
            <h2 className="e-big">
              {compact(stats.totals.tokens)}
              <span className="e-big-unit">tokens</span>
            </h2>
            <p className="e-lede">
              {plural(stats.totals.requests, "request")} on {plural(stats.totals.days, "day")},{" "}
              {pct(person.cacheHit, 0)} of prompts served from cache.
              {stats.streak > 1 && ` A ${stats.streak}-day streak (longest ${stats.longestStreak}).`}
              {bestDay && ` Biggest day: ${compact(bestDay.tokens)}, ${niceDay(bestDay.day)}.`}
              {momentum && (
                <span className="e-delta" title="The last 7 days against the 7 before">
                  {" "}
                  {momentum.text} this week
                </span>
              )}
            </p>
            <DailyBars days={last90.map((day) => ({ day, value: byDay.get(day) ?? 0 }))} />
          </section>

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
              <h2>Details</h2>
            </header>
            <div className="e-groups">
              <Group title="Tokens" rows={kinds} />
              <Group title="Models" rows={models} />
              <Group title="Agents" rows={agentRows} />
              <Group
                title="The week"
                rows={stats.totals.days >= 7 ? [{ label: "Busiest day", value: WEEKDAYS[busiest] }] : []}
              />
              <Group title="Against everyone" note="Share of developers behind" rows={versus} />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
