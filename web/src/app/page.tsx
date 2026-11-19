import Link from "next/link";
import { Segmented } from "@/components/Segmented";
import { Ticker, type TickerFormat } from "@/components/Ticker";
import { currentUser } from "@/lib/auth";
import { ModelName } from "@/components/BrandLogo";
import { compact, count, money, relative, sinceDay } from "@/lib/format";
import type { SerializedLogo } from "@/lib/logos";
import { resolveModelLogos } from "@/lib/logos-server";
import { modelLabel } from "@/lib/pricing";
import {
  METRICS,
  PERIODS,
  boardUpdatedAt,
  globalTotals,
  isMetric,
  isPeriod,
  leaderboard,
  nextBoardUpdate,
  previousRanks,
  rankOf,
  rankedUsers,
  totalUsers,
  type LeaderboardEntry,
  type Metric,
  type Period,
} from "@/lib/stats";

/**
 * The leaderboard.
 *
 * Period and metric live in the query string rather than in client state: the
 * board is server-rendered, every view is linkable, and changing a filter is a
 * plain navigation the back button understands.
 */

export const dynamic = "force-dynamic";

/** One screenful. Short enough to read without scrolling past the filters. */
const PER_PAGE = 15;

export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; metric?: string; page?: string }>;
}) {
  const params = await searchParams;
  const period: Period = isPeriod(params.period) ? params.period : "all";
  const metric: Metric = isMetric(params.metric) ? params.metric : "cost";

  // Every account is ranked, so the page count is the whole population and
  // does not move when the period changes.
  const ranked = await rankedUsers();
  const pageCount = Math.max(1, Math.ceil(ranked / PER_PAGE));

  // Clamp rather than 404: a stale link to page 9 of a board that has shrunk
  // should land on the last page, not on an error.
  const page = Math.min(
    Math.max(Math.trunc(Number(params.page)) || 1, 1),
    pageCount,
  );
  const offset = (page - 1) * PER_PAGE;

  const entries = await leaderboard(period, metric, PER_PAGE, { offset });
  const totals = await globalTotals(period);
  const previous = await previousRanks(period, metric);
  const me = await currentUser();

  // Off this page, your own row is appended so you can see where you stand
  // without paging through the board to find yourself.
  const onBoard = me ? entries.some((entry) => entry.userId === me.id) : false;
  const myRank = me && !onBoard ? await rankOf(me.id, period, metric) : null;
  const myRow =
    myRank !== null
      ? (await leaderboard(period, metric, 1, { offset: myRank - 1 }))[0]
      : undefined;

  const rows = myRow ? [...entries, myRow] : entries;
  const logoMap = await resolveModelLogos(rows.map((entry) => entry.topModel));
  // Index of the appended row, so it can be set apart from the page it is not
  // really part of. -1 when you are on this page already.
  const detachedAt = myRow ? rows.length - 1 : -1;
  const periodLabel =
    PERIODS.find((entry) => entry.key === period)?.label ?? "all time";

  // Asked of the whole window, not of this page: page three being quiet is
  // ordinary, and the note is about nobody having reported at all.
  const silent = totals[metric] === 0;

  // The board's numbers refresh on the hour; profiles update on every sync.
  // Without saying so, someone who has just synced sees their profile move and
  // the board stand still, and reasonably concludes the board is broken.
  const updatedAt = await boardUpdatedAt();
  const minutesToNext = Math.max(
    1,
    Math.ceil((Date.parse(nextBoardUpdate()) - Date.now()) / 60_000),
  );

  return (
    <>
      <section className="stats">
        <Metric
          label="tracked spend"
          value={totals.cost}
          format="usd0"
          foot={periodLabel}
        />
        <Metric
          label="tokens"
          value={totals.tokens}
          format="compact"
          foot="all kinds"
        />
        <Metric
          label="requests"
          value={totals.requests}
          format="compact"
          foot="model calls"
        />
        <Metric
          label="developers"
          value={totals.users}
          format="count"
          foot={`of ${count(await totalUsers())}`}
        />
      </section>

      <section
        style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}
      >
        <div className="row spread">
          <div className="scroll-x">
            <Segmented
              ariaLabel="time period"
              active={period}
              options={PERIODS.map((entry) => ({
                key: entry.key,
                label: entry.label,
                href: `/?period=${entry.key}&metric=${metric}`,
              }))}
            />
          </div>
          <div className="scroll-x">
            <Segmented
              ariaLabel="rank by"
              active={metric}
              options={METRICS.map((entry) => ({
                key: entry.key,
                label: entry.label,
                href: `/?period=${period}&metric=${entry.key}`,
              }))}
            />
          </div>
        </div>

        <p className="micro">
          numbers updated {relative(updatedAt)}, next refresh in{" "}
          {minutesToNext} min. a sync shows on your own profile right away.
        </p>

        {silent && (
          <p className="micro">
            nobody has reported usage in this window yet. everyone who has
            signed up is still listed, in the order they joined.
          </p>
        )}

        {rows.length === 0 ? (
          <p className="empty">
            nobody has signed up yet —{" "}
            <Link href="/login" className="main link">
              create an account
            </Link>{" "}
            to be first
          </p>
        ) : (
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th style={{ width: "3.5rem" }}>#</th>
                  <th>user</th>
                  <th className="r">spend</th>
                  <th className="r">tokens</th>
                  <th className="r">requests</th>
                  <th>model</th>
                  <th className="r">days</th>
                  <th className="r">last</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((entry, index) => (
                  <Row
                    key={entry.userId}
                    entry={entry}
                    index={index}
                    metric={metric}
                    meId={me?.id}
                    previousRank={previous.get(entry.userId)}
                    detached={index === detachedAt}
                    topModelLogo={entry.topModel ? logoMap[entry.topModel] : undefined}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pageCount > 1 && (
          <Pager
            page={page}
            pageCount={pageCount}
            period={period}
            metric={metric}
          />
        )}
      </section>

      {!me && (
        <p className="micro" style={{ textAlign: "center" }}>
          <Link href="/login" className="main link">
            create an account
          </Link>{" "}
          then run <span className="kbd">tokn link</span> to appear here
        </p>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ pager */

function Pager({
  page,
  pageCount,
  period,
  metric,
}: {
  page: number;
  pageCount: number;
  period: Period;
  metric: Metric;
}) {
  const href = (target: number) =>
    `/?period=${period}&metric=${metric}&page=${target}`;

  return (
    <nav className="pager" aria-label="leaderboard pages">
      {page > 1 ? (
        <Link href={href(page - 1)} className="btn" rel="prev">
          &larr; prev
        </Link>
      ) : (
        // A dead link is worse than a disabled control: it looks clickable and
        // then reloads the same page.
        <span className="btn" aria-disabled="true">
          &larr; prev
        </span>
      )}

      {page < pageCount ? (
        <Link href={href(page + 1)} className="btn" rel="next">
          next &rarr;
        </Link>
      ) : (
        <span className="btn" aria-disabled="true">
          next &rarr;
        </span>
      )}
    </nav>
  );
}

/* -------------------------------------------------------------------- row */

function Row({
  entry,
  index,
  metric,
  meId,
  previousRank,
  detached,
  topModelLogo,
}: {
  entry: LeaderboardEntry;
  index: number;
  metric: Metric;
  meId?: string;
  previousRank?: number;
  /** Your own row, carried onto a page it does not belong to. */
  detached?: boolean;
  topModelLogo?: SerializedLogo;
}) {
  // Only the ranked column is at full strength; the others recede.
  const tone = (target: Metric) =>
    metric === target ? undefined : { color: "var(--sub)" };
  const quiet = entry[metric] === 0;

  // Movement describes a change in standing among people who reported. A quiet
  // row's rank comes from the join-date tie-break, so comparing it with a week
  // ago measures who else signed up, not anything this account did — which is
  // how an untouched account ends up flagged as having fallen twenty places.
  const move =
    quiet || previousRank === undefined ? null : previousRank - entry.rank;

  return (
    <tr
      data-me={entry.userId === meId}
      data-quiet={quiet}
      data-detached={detached}
      className="rise"
      style={{ "--i": index } as React.CSSProperties}
    >
      <td className="rank">
        {entry.rank}
        <Move move={move} />
      </td>
      <td>
        <Link href={`/profile/${entry.handle}`} className="link">
          {entry.handle}
        </Link>
        {entry.billing === "subscription" && (
          <span className="tag" style={{ marginLeft: "0.5rem" }}>
            plan
          </span>
        )}
      </td>
      <td className="r" style={tone("cost")}>
        {entry.cost > 0 ? (
          money(entry.cost, 2)
        ) : (
          <span className="idle">&mdash;</span>
        )}
      </td>
      <td className="r" style={tone("tokens")}>
        {entry.tokens > 0 ? (
          compact(entry.tokens)
        ) : (
          <span className="idle">&mdash;</span>
        )}
      </td>
      <td className="r" style={tone("requests")}>
        {entry.requests > 0 ? (
          count(entry.requests)
        ) : (
          <span className="idle">&mdash;</span>
        )}
      </td>
      <td className="sub">
        {entry.topModel ? (
          <ModelName
            model={entry.topModel}
            label={modelLabel(entry.topModel)}
            logo={topModelLogo}
            size={13}
          />
        ) : (
          <span className="idle">&mdash;</span>
        )}
      </td>
      <td className="r sub">
        {entry.days > 0 ? entry.days : <span className="idle">&mdash;</span>}
      </td>
      <td className="r sub">
        {entry.lastDay ? (
          sinceDay(entry.lastDay)
        ) : (
          <span className="idle">&mdash;</span>
        )}
      </td>
    </tr>
  );
}

/** Rank change over the last week, as one quiet character. */
function Move({ move }: { move: number | null }) {
  if (move === null || move === 0) return null;
  const up = move > 0;
  return (
    <span
      className="move"
      data-dir={up ? "up" : "down"}
      style={{ marginLeft: "0.3rem" }}
      title={`${up ? "up" : "down"} ${Math.abs(move)} this week`}
    >
      {up ? "↑" : "↓"}
      {Math.abs(move)}
    </span>
  );
}

/* ----------------------------------------------------------------- metric */

function Metric({
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
