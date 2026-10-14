import type { Metadata } from "next";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { Bars, DayBars, KindSplit, Ranked, Ring, Spark, StackedArea } from "@/components/eaon/charts";
import { Fact, Kpi, PanelHead, change, pct } from "@/components/eaon/parts";
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
 * tokns.eaon.dev: the Eaon Desktop usage index. Everything everyone using
 * Eaon Desktop did, as numbers: tokens by kind and by model, cache hit rate,
 * agent runs, how usage is spread between people, the records, and the
 * board. Served at /eaon on toknhq.com too.
 */

export const dynamic = "force-dynamic";

const TITLE = "Eaon Desktop usage index";
const DESCRIPTION =
  "Tokens, agents, cache hit rates and records from everyone using Eaon Desktop, counted on their own computers.";

export const metadata: Metadata = {
  title: `${TITLE} · tokns`,
  description: DESCRIPTION,
  alternates: { canonical: `${EAON_URL}/` },
  openGraph: { title: TITLE, description: DESCRIPTION, url: `${EAON_URL}/`, siteName: "Eaon", type: "website" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
  const updated = new Date(index.updatedAt);
  const stamp = `${String(updated.getUTCHours()).padStart(2, "0")}:${String(updated.getUTCMinutes()).padStart(2, "0")} UTC`;
  const runsDays = index.days.map((day) => day.runs);
  const usersDays = index.days.map((day) => day.users);
  const dayKeys = index.days.map((day) => day.day);
  const peakWeekday = index.weekdays.reduce((best, day, i, all) => (day.tokens > (all[best]?.tokens ?? 0) ? i : best), 0);
  const avgRun = totals.runs > 0 ? totals.agentMs / totals.runs : 0;
  const topModels = index.models.slice(0, 6);
  const otherModels = index.models.slice(6).reduce((sum, model) => sum + model.tokens, 0);
  const periodLabel = INDEX_PERIODS.find((entry) => entry.key === period)?.label ?? period;

  return (
    <div className="e-page">
      <section className="e-hero" id="overview">
        <div>
          <p className="e-kicker">
            <span className="e-live" aria-hidden="true" /> eaon_desktop.usage_index · snapshot {stamp}
          </p>
          <h1 className="e-title">
            Every token, every agent,
            <br className="e-br" /> from everyone on Eaon.
          </h1>
          <p className="e-lede">
            Counted on each computer by Eaon Desktop, synced through Tokn, refreshed hourly. Private accounts are in every total and
            never named.
          </p>
        </div>
        <nav className="e-seg" aria-label="period">
          {INDEX_PERIODS.map((entry) => (
            <Link key={entry.key} href={href({ period: entry.key })} data-on={entry.key === period || undefined} scroll={false}>
              {entry.label}
            </Link>
          ))}
        </nav>
      </section>

      <section className="e-kpis">
        <Kpi k="developers" v={count(totals.users)} delta={change(totals.users, previous?.users)} foot={`${count(totals.activeToday)} active today`} />
        <Kpi k="tokens" v={compact(totals.tokens)} delta={change(totals.tokens, previous?.tokens)} foot={`${count(totals.requests)} requests`} />
        <Kpi k="agent_runs" v={compact(totals.runs)} delta={change(totals.runs, previous?.runs)} foot={`avg ${duration(avgRun)} each`} />
        <Kpi k="agent_time" v={duration(totals.agentMs)} delta={change(totals.agentMs, previous?.agentMs)} foot={`longest ${duration(totals.longestMs)}`} />
        <Kpi k="cache.hit_rate" v={pct(hit)} foot="of prompt tokens from cache" />
        <Kpi k="output.share" v={pct(totals.tokens > 0 ? totals.kinds.output / totals.tokens : 0, 2)} foot="tokens the models wrote" />
        <Kpi k="tokens / request" v={compact(totals.requests > 0 ? totals.tokens / totals.requests : 0)} foot={`${count(totals.models)} models in use`} />
        <Kpi k="spend.equiv" v={money(totals.cost, 0)} foot={`${money(totals.tokens > 0 ? (totals.cost / totals.tokens) * 1e6 : 0)} per 1M tokens`} />
      </section>

      <section className="e-panel">
        <PanelHead k="tokens.by_kind" title="Tokens per day" note={`${compact(totals.tokens)} in ${periodLabel}`} />
        {index.days.length > 1 ? <StackedArea days={index.days} /> : <p className="e-empty">Not enough days yet to draw a line.</p>}
        <KindSplit kinds={totals.kinds} />
      </section>

      <div className="e-grid e-grid-3">
        <section className="e-panel">
          <PanelHead k="model.share" title="Models" note={`${count(totals.models)} in use`} />
          <Ranked
            items={[
              ...topModels.map((model) => ({ label: model.model, value: model.tokens, sub: `${count(model.users)} ${model.users === 1 ? "developer" : "developers"}` })),
              ...(otherModels > 0 ? [{ label: "everything else", value: otherModels }] : []),
            ]}
          />
        </section>
        <section className="e-panel">
          <PanelHead k="maker.share" title="Who made them" />
          <Ranked items={index.makers.map((maker, i) => ({ label: maker.maker, value: maker.tokens, color: `var(--m-${Math.min(i, 5)})` }))} />
        </section>
        <section className="e-panel e-center">
          <PanelHead k="cache.hit_rate" title="Cache" />
          <Ring value={hit} label="hit rate" size={136} />
          <dl className="e-facts">
            <Fact k="read from cache" v={compact(totals.kinds.cacheRead)} />
            <Fact k="written to cache" v={compact(totals.kinds.cacheWrite)} />
            <Fact k="fresh input" v={compact(totals.kinds.input)} />
            <Fact k="read : write" v={totals.kinds.cacheWrite > 0 ? `${(totals.kinds.cacheRead / totals.kinds.cacheWrite).toFixed(1)} : 1` : "—"} />
          </dl>
        </section>
      </div>

      <div className="e-grid e-grid-3">
        <section className="e-panel">
          <PanelHead k="load.by_weekday" title="Busiest days" note={`peak: ${WEEKDAYS[peakWeekday]}`} />
          <Bars values={index.weekdays.map((day) => day.tokens)} labels={WEEKDAYS} unit=" tokens" height={150} />
          <p className="e-note">
            Weekends carry {pct(((index.weekdays[5]?.tokens ?? 0) + (index.weekdays[6]?.tokens ?? 0)) / Math.max(1, totals.tokens), 0)} of all
            tokens.
          </p>
        </section>
        <section className="e-panel">
          <PanelHead k="agents.per_day" title="Agent runs" note={`${compact(totals.runs)} total`} />
          <DayBars values={runsDays} days={dayKeys} height={96} label="agent runs per day" />
          <PanelHead k="devs.per_day" title="Developers active" note={`peak ${count(Math.max(0, ...usersDays))}`} small />
          <DayBars values={usersDays} days={dayKeys} height={56} label="developers active per day" tone="violet" />
        </section>
        <section className="e-panel">
          <PanelHead k="users.distribution" title="How usage is spread" note="developers by tokens" />
          <Bars
            values={index.distribution.buckets.map((bucket) => bucket.users)}
            labels={index.distribution.buckets.map((bucket) => bucket.label)}
            format={count}
            unit=" developers"
            height={110}
            className="e-bars-alt"
          />
          <dl className="e-facts e-facts-4">
            <Fact k="p50" v={compact(index.distribution.p50)} />
            <Fact k="p90" v={compact(index.distribution.p90)} />
            <Fact k="p99" v={compact(index.distribution.p99)} />
            <Fact k="gini" v={index.distribution.gini.toFixed(2)} title="0 is everyone using the same; 1 is one person using it all" />
          </dl>
          <p className="e-note">The top 10% of developers use {pct(index.distribution.top10Share, 0)} of the tokens.</p>
        </section>
      </div>

      <section id="records">
        <h2 className="e-h2">
          <span className="e-k">records</span> All time
        </h2>
        <div className="e-records">
          {index.records.map((record) => (
            <RecordCard key={record.label} record={record} profile={paths.profile} />
          ))}
        </div>
      </section>

      <section className="e-panel e-board" id="board">
        <div className="e-board-head">
          <PanelHead k="board" title="Leaderboard" note={`${count(index.entries.length)} listed`} />
          <nav className="e-seg e-seg-sm" aria-label="rank by">
            {INDEX_SORTS.map((entry) => (
              <Link key={entry.key} href={href({ sort: entry.key }, "#board")} data-on={entry.key === sort || undefined} scroll={false}>
                {entry.label}
              </Link>
            ))}
          </nav>
        </div>
        {index.entries.length === 0 ? (
          <p className="e-empty">
            Nobody has synced Eaon Desktop usage in this period yet. Sign in with Tokn in the app and you’ll show up within the hour.
          </p>
        ) : (
          <div className="e-table-wrap">
            <table className="e-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>developer</th>
                  <th className="r">tokens</th>
                  <th className="r">agents</th>
                  <th className="r hide-sm">agent time</th>
                  <th className="r hide-md">longest</th>
                  <th className="r hide-sm">cache hit</th>
                  <th className="hide-md">top model</th>
                  <th className="r">streak</th>
                  <th className="r hide-sm">last 3 weeks</th>
                </tr>
              </thead>
              <tbody>
                {index.entries.slice(0, 100).map((entry) => (
                  <BoardRow key={entry.userId} entry={entry} href={paths.profile(entry.handle)} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Trivia index={index} />

      <p className="e-cta">
        On Eaon Desktop?{" "}
        <a href={`${TOKN_URL}/account/eaon`} className="e-link">
          Sign in with Tokn
        </a>{" "}
        and your profile appears at tokns.eaon.dev/@you.
      </p>
    </div>
  );
}

function recordValue(record: IndexRecord): string {
  const n = Number(record.value);
  if (record.label === "biggest day") return `${compact(n)} tokens`;
  if (record.label === "longest agent run") return duration(n);
  if (record.label === "longest streak") return `${count(n)} days`;
  if (record.label === "most agents in a day") return `${count(n)} runs`;
  return `${count(n)} models`;
}

function RecordCard({ record, profile }: { record: IndexRecord; profile: (handle: string) => string }) {
  return (
    <div className="e-record">
      <span className="e-k">{record.label}</span>
      <span className="e-record-v">{recordValue(record)}</span>
      <span className="e-record-who">
        {record.who.handle ? (
          <Link href={profile(record.who.handle)} className="e-link">
            @{record.who.handle}
          </Link>
        ) : (
          <span className="e-dim">a private developer</span>
        )}
        {record.day && <span className="e-dim"> · {niceDay(record.day)}</span>}
      </span>
    </div>
  );
}

function BoardRow({ entry, href }: { entry: IndexEntry; href: string }) {
  const prefs = parsePrefs(entry.prefs);
  return (
    <tr>
      <td className="e-rank" data-top={entry.rank <= 3 || undefined}>
        {String(entry.rank).padStart(2, "0")}
      </td>
      <td>
        <Link href={href} className="e-who">
          <Avatar handle={entry.handle} size={24} style={prefs.avatar} url={entry.avatarUrl} />
          <span className="e-who-name">{entry.name?.trim() || entry.handle}</span>
          <span className="e-who-handle">@{entry.handle}</span>
        </Link>
      </td>
      <td className="r e-num">{entry.tokens > 0 ? compact(entry.tokens) : "—"}</td>
      <td className="r e-num">{entry.runs > 0 ? count(entry.runs) : "—"}</td>
      <td className="r e-num hide-sm">{entry.agentMs > 0 ? duration(entry.agentMs) : "—"}</td>
      <td className="r e-num hide-md">{entry.longestMs > 0 ? duration(entry.longestMs) : "—"}</td>
      <td className="r e-num hide-sm">{entry.tokens > 0 ? pct(entry.cacheHit) : "—"}</td>
      <td className="hide-md e-model">{entry.topModel ?? "—"}</td>
      <td className="r e-num">{entry.streak > 0 ? `${entry.streak}d` : "—"}</td>
      <td className="r hide-sm">
        <Spark values={entry.series} label={`${entry.handle}, tokens per day`} />
      </td>
    </tr>
  );
}

/**
 * The same totals, put in terms of other things. Rough on purpose: the point
 * is the scale, so every comparison says what it assumed.
 */
function Trivia({ index }: { index: EaonIndex }) {
  const { totals } = index;
  // War and Peace: about 587K words, so roughly 780K tokens at 0.75 words a token.
  const warAndPeace = totals.tokens / 780_000;
  // About 4 characters a token, 3,000 characters to a printed page.
  const pages = (totals.tokens * 4) / 3000;
  // A person reading 250 words a minute, eight hours a day.
  const readingYears = (totals.kinds.output * 0.75) / 250 / 60 / 8 / 365;
  // Agent time as working days of eight hours.
  const workDays = totals.agentMs / 3_600_000 / 8;
  const first = index.days.find((day) => day.tokens > 0);
  return (
    <section className="e-panel e-trivia">
      <PanelHead k="for_scale" title="For scale" note="rough, and says how" />
      <ul>
        <li>
          <span className="e-trivia-v">{count(warAndPeace)}×</span> War and Peace, at about 780K tokens a copy
        </li>
        <li>
          <span className="e-trivia-v">{compact(pages)}</span> printed pages, at 4 characters a token and 3,000 to a page
        </li>
        <li>
          <span className="e-trivia-v">{readingYears.toFixed(1)} years</span> for one person to read what the models wrote, 8 hours a day at 250
          words a minute
        </li>
        <li>
          <span className="e-trivia-v">{count(workDays)}</span> eight-hour working days of agents working on their own
        </li>
        {first && (
          <li>
            <span className="e-trivia-v">{compact(totals.tokens / Math.max(1, index.days.length))}</span> tokens a day on average since{" "}
            {shortDay(first.day)}
          </li>
        )}
      </ul>
    </section>
  );
}
