import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { DailyBars, KINDS } from "@/components/eaon/charts";
import { Group, change, pct, type Row } from "@/components/eaon/parts";
import { compact, count, duration, money, niceDay, shortDay } from "@/lib/format";
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
 * The board first, as superset.sh/leaderboard has it but quieter: a title,
 * four totals, what to rank by and the period, then the table. Under it the
 * stats: the days, then plain lists, each appearing only once there is
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
  const first = index.days[0]?.day;
  const last = index.days[index.days.length - 1]?.day;
  const range = first && last ? `${shortDay(first)} – ${shortDay(last)}` : "";
  const sortLabel = INDEX_SORTS.find((entry) => entry.key === sort)?.label ?? "Tokens";

  return (
    <div className="e-page">
      <header className="e-title">
        <div>
          <h1>Leaderboard</h1>
          <p>Everyone using Eaon Desktop, by how much they use it.</p>
        </div>
        <a href={`${TOKN_URL}/account/eaon`} className="e-join">
          Join the leaderboard <span aria-hidden="true">→</span>
        </a>
      </header>

      <dl className="e-totals">
        <div>
          <dt>Developers</dt>
          <dd>{count(totals.users)}</dd>
        </div>
        <div>
          <dt>Tokens</dt>
          <dd>
            {compact(totals.tokens)}
            {delta && <span className="e-delta">{delta.text}</span>}
          </dd>
        </div>
        <div>
          <dt>Spend</dt>
          <dd>{money(totals.cost, totals.cost < 100 ? 2 : 0)}</dd>
        </div>
        <div>
          <dt>Cache read</dt>
          <dd>{totals.tokens > 0 ? pct(hit, 0) : "—"}</dd>
        </div>
      </dl>

      <section className="e-section" id="board" aria-label="Leaderboard">
        <div className="e-controls">
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
          <div className="e-controls-end">
            <nav className="e-tabs" aria-label="Period">
              {INDEX_PERIODS.map((entry) => (
                <Link
                  key={entry.key}
                  href={href({ period: entry.key }, "#board")}
                  aria-current={entry.key === period ? "page" : undefined}
                  scroll={false}
                >
                  {entry.label}
                </Link>
              ))}
            </nav>
            {range && period !== "all" && <span className="e-range">{range}</span>}
          </div>
        </div>
        {index.entries.length === 0 ? (
          <p className="e-empty">Nobody has synced Eaon Desktop usage in this period yet.</p>
        ) : (
          <table className="e-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Developer</th>
                <th scope="col" className="e-col-mid">
                  {sort === "tokens" ? "Requests" : "Tokens"}
                </th>
                <th scope="col">{sortLabel}</th>
              </tr>
            </thead>
            <tbody>
              {index.entries.slice(0, 100).map((entry) => (
                <BoardRow
                  key={entry.userId}
                  entry={entry}
                  href={paths.profile(entry.handle)}
                  sort={sort}
                />
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="e-section" id="stats">
        <header className="e-section-head">
          <h2>Stats</h2>
          <span className="e-section-note">Eaon Desktop, {PERIOD_WORDS[period]}</span>
        </header>
        <DailyBars days={index.days.map((day) => ({ day: day.day, value: day.tokens }))} />
        <Details index={index} activeDays={activeDays} profile={paths.profile} />
      </section>
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

function BoardRow({ entry, href, sort }: { entry: IndexEntry; href: string; sort: IndexSort }) {
  const prefs = parsePrefs(entry.prefs);
  const main = sortValue(entry, sort);
  return (
    <tr>
      <td className="e-col-rank">{entry.rank}</td>
      <td>
        <Link href={href} className="e-who">
          <Avatar handle={entry.handle} size={32} style={prefs.avatar} url={entry.avatarUrl} />
          <span className="e-who-names">
            <span className="e-who-name">{entry.name?.trim() || entry.handle}</span>
            <span className="e-who-handle">@{entry.handle}</span>
          </span>
        </Link>
      </td>
      <td className="e-col-mid">{sort === "tokens" ? compact(entry.requests) : compact(entry.tokens)}</td>
      <td className="e-col-value">{main.value}</td>
    </tr>
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
    <div className="e-groups">
      <Group title="Tokens" rows={kinds} />
      <Group title="Models" rows={models} />
      <Group title="Agents" rows={agents} />
      <Group title="The week" rows={week} />
      <Group title="Spread" note="Tokens per developer" rows={spread} />
      <Group title="Records" note="All time" rows={records} />
    </div>
  );
}
