import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { Bars, DailyBars, KindSplit, Ranked, Spark } from "@/components/eaon/charts";
import { Card, Facts, Stat, change, pairCards, pct } from "@/components/eaon/parts";
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
 * The top is one figure (tokens in the period) and its days; then the board;
 * then "Under the hood", whose cards each appear only once there is enough
 * behind them to mean something. A distribution of two people, or records
 * held by the only person here, would be noise.
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

  return (
    <div className="e-page">
      <section className="e-hero">
        <div className="e-hero-top">
          <p className="e-eyebrow">Eaon Desktop · {PERIOD_WORDS[period]}</p>
          <nav className="e-tabs" aria-label="Period">
            {INDEX_PERIODS.map((entry) => (
              <Link
                key={entry.key}
                href={href({ period: entry.key })}
                data-on={entry.key === period || undefined}
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
          {change(totals.tokens, previous?.tokens) && (
            <span
              className="e-delta e-delta-big"
              data-up={change(totals.tokens, previous?.tokens)!.up}
            >
              {change(totals.tokens, previous?.tokens)!.text}
            </span>
          )}
        </h1>
        <p className="e-lede">
          From {plural(totals.users, "developer")}, {plural(totals.requests, "request")}
          {totals.tokens > 0 && <>, with {pct(hit, 0)} of prompts served from cache</>}. Counted on
          each computer and synced through Tokn.
        </p>
        <DailyBars days={index.days.map((day) => ({ day: day.day, value: day.tokens }))} />
      </section>

      <dl className="e-stats">
        <Stat
          label="Developers"
          value={count(totals.users)}
          delta={change(totals.users, previous?.users)}
          note={totals.activeToday > 0 ? `${count(totals.activeToday)} active today` : undefined}
        />
        <Stat
          label="Agent runs"
          value={totals.runs > 0 ? compact(totals.runs) : "—"}
          delta={change(totals.runs, previous?.runs)}
          note={totals.runs > 0 ? `${duration(totals.agentMs)} of work` : "None synced yet"}
        />
        <Stat
          label="Cache hit rate"
          value={totals.tokens > 0 ? pct(hit) : "—"}
          note="Prompt tokens served from cache"
        />
        <Stat
          label="Per request"
          value={totals.requests > 0 ? compact(totals.tokens / totals.requests) : "—"}
          note={plural(totals.models, "model") + " in use"}
        />
      </dl>

      <section className="e-section" id="board">
        <header className="e-section-head">
          <h2>Leaderboard</h2>
          <nav className="e-tabs e-tabs-quiet" aria-label="Rank by">
            {INDEX_SORTS.map((entry) => (
              <Link
                key={entry.key}
                href={href({ sort: entry.key }, "#board")}
                data-on={entry.key === sort || undefined}
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
        <p className="e-cta">
          Using Eaon Desktop? <a href={`${TOKN_URL}/account/eaon`}>Sign in with Tokn</a> in the app
          and you’ll show up here within the hour.
        </p>
      </section>

      <UnderTheHood index={index} activeDays={activeDays} profile={paths.profile} />
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
    entry.topModel,
    entry.streak > 0 ? `${entry.streak}-day streak` : null,
    entry.runs > 0 ? plural(entry.runs, "agent run") : null,
  ].filter(Boolean);
  return (
    <li className="e-row">
      <span className="e-row-rank" data-top={entry.rank <= 3 ? entry.rank : undefined}>
        {entry.rank}
      </span>
      <Link href={href} className="e-row-who">
        <Avatar handle={entry.handle} size={36} style={prefs.avatar} url={entry.avatarUrl} />
        <span className="e-row-names">
          <span className="e-row-name">
            {entry.name?.trim() || entry.handle}{" "}
            <span className="e-row-handle">@{entry.handle}</span>
          </span>
          <span className="e-row-facts">{facts.join(" · ")}</span>
        </span>
      </Link>
      <span className="e-row-spark">
        <Spark values={entry.series} label={`${entry.handle}, tokens per day`} />
      </span>
      <span className="e-row-value">
        {main.value}
        <span>
          {sort === "tokens" && total > 0 ? pct(entry.tokens / total, 0) + " of all" : main.unit}
        </span>
      </span>
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

function UnderTheHood({
  index,
  activeDays,
  profile,
}: {
  index: EaonIndex;
  activeDays: number;
  profile: (handle: string) => string;
}) {
  const { totals } = index;
  const cards: React.ReactNode[] = [];

  if (totals.tokens > 0) {
    cards.push(
      <Card key="kinds" title="What the tokens were" note="By kind" wide>
        <KindSplit kinds={totals.kinds} />
        <Facts
          items={[
            ["Output share", pct(totals.kinds.output / totals.tokens, 2)],
            [
              "Cache read : write",
              totals.kinds.cacheWrite > 0
                ? `${(totals.kinds.cacheRead / totals.kinds.cacheWrite).toFixed(1)} : 1`
                : "—",
            ],
            ["Spend at API prices", money(totals.cost, totals.cost < 100 ? 2 : 0)],
            ["Per million tokens", money((totals.cost / totals.tokens) * 1e6)],
          ]}
        />
      </Card>,
    );
    cards.push(
      <Card key="models" title="Models" note={plural(totals.models, "model")} wide={activeDays < 7}>
        <Ranked
          items={index.models
            .slice(0, 5)
            .map((model) => ({
              label: model.model,
              value: model.tokens,
              sub: plural(model.users, "developer"),
            }))}
        />
      </Card>,
    );
  }
  if (activeDays >= 7) {
    const weekend =
      ((index.weekdays[5]?.tokens ?? 0) + (index.weekdays[6]?.tokens ?? 0)) /
      Math.max(1, totals.tokens);
    cards.push(
      <Card key="week" title="The week" note={`Weekends: ${pct(weekend, 0)}`}>
        <Bars values={index.weekdays.map((day) => day.tokens)} labels={WEEKDAYS} unit=" tokens" />
      </Card>,
    );
  }
  if (totals.runs > 0) {
    cards.push(
      <Card key="agents" title="Agents" note={plural(totals.runs, "run")}>
        <DailyBars
          days={index.days.map((day) => ({ day: day.day, value: day.runs }))}
          height={90}
          unit="runs"
          format={count}
        />
        <Facts
          items={[
            ["Average run", duration(totals.agentMs / totals.runs)],
            ["Longest run", duration(totals.longestMs)],
            ["Agent time", duration(totals.agentMs)],
          ]}
        />
      </Card>,
    );
  }
  if (totals.users >= 5) {
    cards.push(
      <Card key="spread" title="How usage is spread" note="Tokens per developer">
        <Bars
          values={index.distribution.buckets.map((bucket) => bucket.users)}
          labels={index.distribution.buckets.map((bucket) => bucket.label)}
          format={count}
          unit=" developers"
        />
        <Facts
          items={[
            ["Median", compact(index.distribution.p50)],
            ["90th percentile", compact(index.distribution.p90)],
            ["Gini", index.distribution.gini.toFixed(2)],
          ]}
        />
        <p className="e-card-text">
          The top tenth of developers use {pct(index.distribution.top10Share, 0)} of all tokens.
        </p>
      </Card>,
    );
  }
  // Records once there is someone to hold them against.
  if (totals.users >= 3 && index.records.length > 0) {
    cards.push(
      <Card key="records" title="Records" note="All time" wide>
        <ul className="e-records">
          {index.records.map((record) => (
            <li key={record.label}>
              <span className="e-records-label">{record.label}</span>
              <span className="e-records-value">{recordText(record)}</span>
              <span className="e-records-who">
                {record.who.handle ? (
                  <Link href={profile(record.who.handle)}>@{record.who.handle}</Link>
                ) : (
                  "A private developer"
                )}
                {record.day && ` · ${niceDay(record.day)}`}
              </span>
            </li>
          ))}
        </ul>
      </Card>,
    );
  }
  if (totals.tokens >= 10_000_000) {
    cards.push(
      <Card key="scale" title="For scale" wide>
        <ul className="e-scale">
          <li>
            <b>{count(totals.tokens / 780_000)}×</b> War and Peace, at about 780K tokens a copy
          </li>
          <li>
            <b>{compact((totals.tokens * 4) / 3000)}</b> printed pages, at 4 characters a token
          </li>
          {totals.agentMs >= 8 * 3_600_000 && (
            <li>
              <b>{count(totals.agentMs / 3_600_000 / 8)}</b> eight-hour days of agents working on
              their own
            </li>
          )}
        </ul>
      </Card>,
    );
  }

  if (cards.length === 0) return null;
  const laidOut = pairCards(cards as React.ReactElement<{ wide?: boolean }>[]);

  return (
    <section className="e-section" id="details">
      <header className="e-section-head">
        <h2>Under the hood</h2>
      </header>
      <div className="e-cards">{laidOut}</div>
    </section>
  );
}
