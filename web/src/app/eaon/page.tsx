import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { DailyBars, KINDS } from "@/components/eaon/charts";
import { Group, change, pct, type Row } from "@/components/eaon/parts";
import { compact, count, duration, money, niceDay } from "@/lib/format";
import { parsePrefs } from "@/lib/prefs";
import {
  INDEX_PERIODS,
  INDEX_SORTS,
  cacheHit,
  eaonIndex,
  isIndexPeriod,
  isIndexSort,
  type EaonIndex,
  type IndexEntry,
  type IndexPeriod,
  type IndexRecord,
  type IndexSort,
} from "@/lib/eaon";
import { EAON_URL, TOKN_URL, currentSite, eaonPaths } from "@/lib/sites";

/**
 * tokns.eaon.dev: the Eaon Desktop leaderboard, and the numbers behind it.
 *
 * One figure (tokens in the period), one sentence and its days; then the
 * board; then the details as plain lists, each appearing only once there is
 * enough behind it to mean something. A distribution of two people, or
 * records held by the only person here, would be noise.
 */

export const dynamic = "force-dynamic";

const TITLE = "Eaon Desktop leaderboard";
const DESCRIPTION =
  "Tokens, agents and streaks from everyone using Eaon Desktop, counted on their own computers.";

export const metadata: Metadata = {
  title: `${TITLE} · tokns`,
  description: DESCRIPTION,
  alternates: { canonical: `${EAON_URL}/` },
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    url: `${EAON_URL}/`,
    siteName: "Eaon",
    type: "website",
  },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const PERIOD_WORDS: Record<IndexPeriod, string> = {
  "7d": "in the last 7 days",
  "30d": "in the last 30 days",
  "90d": "in the last 90 days",
  all: "all time",
};
const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;

export default async function EaonIndexPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; sort?: string }>;
}) {
  const params = await searchParams;
  const period: IndexPeriod = isIndexPeriod(params.period) ? params.period : "30d";
  const sort: IndexSort = isIndexSort(params.sort) ? params.sort : "tokens";
  const site = await currentSite();
  const paths = eaonPaths(site);
  const index = await eaonIndex(period, sort);
  const { totals, previous } = index;
  const href = (next: { period?: IndexPeriod; sort?: IndexSort }, hash = "") =>
    `${paths.board}?period=${next.period ?? period}&sort=${next.sort ?? sort}${hash}`;
  const hit = cacheHit(totals.kinds);
  const activeDays = index.days.filter((day) => day.tokens > 0).length;

  const delta = change(totals.tokens, previous?.tokens);
  const extras = [
    totals.runs > 0 ? plural(totals.runs, "agent run") : null,
    totals.activeToday > 0 ? `${count(totals.activeToday)} active today` : null,
  ].filter(Boolean);

  return (
    <div className="e-page">
      <section className="e-hero">
        <div className="e-hero-top">
          <p className="e-eyebrow">Eaon Desktop, {PERIOD_WORDS[period]}</p>
          <nav className="e-tabs" aria-label="Period">
            {INDEX_PERIODS.map((entry) => (
              <Link
                key={entry.key}
                href={href({ period: entry.key })}
                aria-current={entry.key === period ? "page" : undefined}
                scroll={false}
              >
                {entry.label}
              </Link>
            ))}
          </nav>
        </div>
        <h1 className="e-big">
          {compact(totals.tokens)}
          <span className="e-big-unit">tokens</span>
        </h1>
        <p className="e-lede">
          From {plural(totals.users, "developer")} and {plural(totals.requests, "request")}
          {totals.tokens > 0 && <>, {pct(hit, 0)} of prompts served from cache</>}.
          {extras.length > 0 && <> {extras.join(", ")}.</>}
          {delta && (
            <span className="e-delta">
              {" "}
              {delta.text} on the {period === "all" ? "period before" : `${period.replace("d", "")} days before`}
            </span>
          )}
        </p>
        <DailyBars days={index.days.map((day) => ({ day: day.day, value: day.tokens }))} />
      </section>

      <section className="e-section" id="board">
        <header className="e-section-head">
          <h2>Leaderboard</h2>
          <nav className="e-tabs" aria-label="Rank by">
            {INDEX_SORTS.map((entry) => (
              <Link
                key={entry.key}
                href={href({ sort: entry.key }, "#board")}
                aria-current={entry.key === sort ? "page" : undefined}
                scroll={false}
              >
                {entry.label}
              </Link>
            ))}
          </nav>
        </header>
        {index.entries.length === 0 ? (
          <p className="e-empty">Nobody has synced Eaon Desktop usage in this period yet.</p>
        ) : (
          <ol className="e-board">
            {index.entries.slice(0, 100).map((entry) => (
              <BoardRow
                key={entry.userId}
                entry={entry}
                href={paths.profile(entry.handle)}
                total={totals.tokens}
                sort={sort}
              />
            ))}
          </ol>
        )}
        <p className="e-note">
          Using Eaon Desktop? <a href={`${TOKN_URL}/account/eaon`}>Sign in with Tokn</a> in the app
          and you’ll show up here within the hour.
        </p>
      </section>

      <Details index={index} activeDays={activeDays} profile={paths.profile} />
    </div>
  );
}

function sortValue(entry: IndexEntry, sort: IndexSort): { value: string; unit: string } {
  switch (sort) {
    case "agents":
      return { value: entry.runs > 0 ? compact(entry.runs) : "—", unit: "runs" };
    case "time":
      return { value: entry.agentMs > 0 ? duration(entry.agentMs) : "—", unit: "agent time" };
    case "streak":
      return { value: entry.streak > 0 ? `${entry.streak}d` : "—", unit: "streak" };
    case "cache":
      return { value: entry.tokens > 0 ? pct(entry.cacheHit) : "—", unit: "cache hit" };
    default:
      return { value: compact(entry.tokens), unit: "tokens" };
  }
}

function BoardRow({
  entry,
  href,
  total,
  sort,
}: {
  entry: IndexEntry;
  href: string;
  total: number;
  sort: IndexSort;
}) {
  const prefs = parsePrefs(entry.prefs);
  const main = sortValue(entry, sort);
  const facts = [
    `@${entry.handle}`,
    entry.topModel,
    entry.streak > 1 ? `${entry.streak}-day streak` : null,
  ].filter(Boolean);
  return (
    <li>
      <Link href={href} className="e-row">
        <span className="e-row-rank">{entry.rank}</span>
        <Avatar handle={entry.handle} size={32} style={prefs.avatar} url={entry.avatarUrl} />
        <span className="e-row-names">
          <span className="e-row-name">{entry.name?.trim() || entry.handle}</span>
          <span className="e-row-facts">{facts.join(" · ")}</span>
        </span>
        <span className="e-row-value">
          {main.value}
          <span>
            {sort === "tokens" && total > 0 ? pct(entry.tokens / total, 0) : main.unit}
          </span>
        </span>
      </Link>
    </li>
  );
}

function recordText(record: IndexRecord): string {
  const n = Number(record.value);
  if (record.label === "biggest day") return `${compact(n)} tokens`;
  if (record.label === "longest agent run") return duration(n);
  if (record.label === "longest streak") return plural(n, "day");
  if (record.label === "most agents in a day") return plural(n, "run");
  return plural(n, "model");
}

const sentence = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

function Details({
  index,
  activeDays,
  profile,
}: {
  index: EaonIndex;
  activeDays: number;
  profile: (handle: string) => string;
}) {
  const { totals } = index;
  if (totals.tokens <= 0) return null;

  const kinds: Row[] = KINDS.map((kind) => ({
    label: kind.label,
    value: (
      <>
        {compact(totals.kinds[kind.key])}
        <span>{pct(totals.kinds[kind.key] / totals.tokens)}</span>
      </>
    ),
  }));
  kinds.push({ label: "Spend at API prices", value: money(totals.cost, totals.cost < 100 ? 2 : 0) });

  const models: Row[] = index.models.slice(0, 5).map((model) => ({
    key: model.model,
    label: model.model,
    sub: plural(model.users, "developer"),
    value: compact(model.tokens),
  }));

  const agents: Row[] =
    totals.runs > 0
      ? [
          { label: "Runs", value: count(totals.runs) },
          { label: "Average run", value: duration(totals.agentMs / totals.runs) },
          { label: "Longest run", value: duration(totals.longestMs) },
          { label: "Time working", value: duration(totals.agentMs) },
        ]
      : [];

  const busiest = index.weekdays.reduce(
    (best, day, i, all) => (day.tokens > (all[best]?.tokens ?? 0) ? i : best),
    0,
  );
  const weekend =
    ((index.weekdays[5]?.tokens ?? 0) + (index.weekdays[6]?.tokens ?? 0)) /
    Math.max(1, totals.tokens);
  const week: Row[] =
    activeDays >= 7
      ? [
          { label: "Busiest day", value: WEEKDAYS[busiest] },
          { label: "Weekends", value: pct(weekend, 0) },
        ]
      : [];

  const spread: Row[] =
    totals.users >= 5
      ? [
          { label: "Median developer", value: compact(index.distribution.p50) },
          { label: "90th percentile", value: compact(index.distribution.p90) },
          { label: "Top tenth’s share", value: pct(index.distribution.top10Share, 0) },
        ]
      : [];

  const records: Row[] =
    totals.users >= 3
      ? index.records.map((record) => ({
          key: record.label,
          label: sentence(record.label),
          sub: (
            <>
              {record.who.handle ? (
                <Link href={profile(record.who.handle)}>@{record.who.handle}</Link>
              ) : (
                "A private developer"
              )}
              {record.day && `, ${niceDay(record.day)}`}
            </>
          ),
          value: recordText(record),
        }))
      : [];

  return (
    <section className="e-section" id="details">
      <header className="e-section-head">
        <h2>Details</h2>
      </header>
      <div className="e-groups">
        <Group title="Tokens" rows={kinds} />
        <Group title="Models" rows={models} />
        <Group title="Agents" rows={agents} />
        <Group title="The week" rows={week} />
        <Group title="Spread" note="Tokens per developer" rows={spread} />
        <Group title="Records" note="All time" rows={records} />
      </div>
    </section>
  );
}
