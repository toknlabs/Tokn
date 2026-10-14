import Link from "next/link";
import { AreaChart, ShareBars, StackedDays } from "@/components/Charts";
import { PagedBars } from "@/components/PagedBars";
import { Avatar } from "@/components/Avatar";
import { Heatmap } from "@/components/Heatmap";
import { ShareButton } from "@/components/ShareButton";
import { SocialIcon } from "@/components/SocialIcon";
import {
  compact,
  count,
  money,
  niceDay,
  percent,
  sinceDay,
} from "@/lib/format";
import { parseLinks } from "@/lib/links";
import {
  KIND_LABELS,
  hasPricedPlan,
  monthlyTotal,
  parsePlans,
  providerName,
  subscriptionMonthly,
  type Plan,
} from "@/lib/plans";
import { modelLabel } from "@/lib/pricing";
import {
  STAT_LABELS,
  parsePrefs,
  type BlockKey,
  type ProfilePrefs,
  type StatKey,
} from "@/lib/prefs";
import { userStats, type UserStats } from "@/lib/stats";
import { CostAnatomy } from "@/components/CostAnatomy";
import { Savings } from "@/components/Savings";
import {
  anatomyFor,
  burnRate,
  reuseBenchmark,
  whatIf as whatIfFor,
} from "@/lib/backend";

/**
 * The profile, shared by /profile/[handle] and /account.
 *
 * A stack of blocks with nothing drawn around them: a label, the figure, and
 * the shape of it. Separation is the gap between blocks and nothing else.
 *
 * Which blocks appear, in what order, which four figures lead, the accent and
 * the avatar all come from the owner's preferences. The accent is scoped with
 * `data-accent` on the wrapper, so a profile recolours itself without touching
 * the chrome around it.
 *
 * Everything derives from one all-time series. Slicing it in memory beats five
 * more round trips, and the series is a few thousand rows even for the
 * heaviest user on the board.
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

const WINDOW_DAYS = 90;

export async function ProfileView({
  user,
  rank,
  own = false,
  identity = true,
}: {
  user: ProfileUser;
  rank: number | null;
  own?: boolean;
  /**
   * Whether to draw the name, links and bio.
   *
   * Off inside the account section, where the section layout already says who
   * you are and repeating it puts two headers on one page.
   */
  identity?: boolean;
}) {
  // Fetched together: four round trips in series would be felt, and the
  // anatomy needs the same rows the summary already walks.
  const [stats, anatomy, whatIf] = await Promise.all([
    userStats(user.id, "all"),
    anatomyFor(user.id),
    whatIfFor(user.id),
  ]);
  const benchmark = await reuseBenchmark(user.id, anatomy);
  const prefs = parsePrefs(user.prefs);
  const links = parseLinks(user.links);
  const plans = parsePlans(user.plans);
  const hasUsage = stats.totals.requests > 0;
  const recent = stats.byDay.slice(-WINDOW_DAYS);

  return (
    <div data-accent={prefs.accent} style={{ display: "contents" }}>
      {identity && (
        <section className="row spread">
          <div className="profile-head">
            <Avatar
              handle={user.handle}
              size={44}
              style={prefs.avatar}
              url={user.avatarUrl}
            />
            <div style={{ minWidth: 0 }}>
              <h1 className="profile-name">
                {user.name?.trim() || user.handle}
              </h1>
              <div className="profile-handle">
                <span>@{user.handle}</span>
                {user.billing === "subscription" && (
                  <span className="tag">plan</span>
                )}
                {rank && (
                  <Link href="/" className="tag on link">
                    #{rank}
                  </Link>
                )}
                {own && !user.isPublic && <span className="tag">private</span>}
                {own && user.isPublic && !user.listed && (
                  <span className="tag">unlisted</span>
                )}
              </div>
            </div>
          </div>

          <div className="row" style={{ gap: "0.5rem" }}>
            <ShareButton handle={user.handle} />
            {own && (
              <Link href="/account/settings" className="btn">
                edit
              </Link>
            )}
          </div>
        </section>
      )}

      {identity && (links.length > 0 || user.bio || own) && (
        <section
          className="row"
          style={{ gap: "1.5rem", marginTop: "-1.75rem", fontSize: "0.75rem" }}
        >
          <span className="sub">joined {sinceJoin(user.createdAt)}</span>

          {links.length > 0 && (
            <div className="links">
              {links.map((link) => (
                <a
                  key={link.url}
                  href={link.url}
                  target="_blank"
                  rel="me noreferrer noopener"
                >
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

          {user.bio && <span className="sub">{user.bio}</span>}
        </section>
      )}

      <section className="stats">
        {prefs.stats.map((key) => (
          <Stat
            key={key}
            k={STAT_LABELS[key]}
            {...statValue(key, stats, hasUsage, plans)}
          />
        ))}
      </section>

      {!hasUsage ? (
        <>
          <p className="empty">
            {own ? (
              <>
                nothing reported yet — connect a machine and run{" "}
                <span className="kbd">tokn sync</span>
              </>
            ) : (
              "this account has not reported any usage yet"
            )}
          </p>
          {/* Declared, not measured, so it stands on its own: someone who has
              listed their plans but not synced yet still has something to
              show, and hiding it would be the one section that needs no data
              waiting on data. */}
          {plans.length > 0 && <Plans plans={plans} stats={stats} own={own} />}
        </>
      ) : (
        <>
          {prefs.blocks.map((block) => (
            <Block
              key={block}
              block={block}
              stats={stats}
              recent={recent}
              prefs={prefs}
              plans={plans}
              own={own}
            />
          ))}
          {/* Owner only. "What you could have spent less" is a statement
              about somebody's money and their judgement, and a leaderboard
              visitor has no business reading either. */}
          {own && (
          <Savings
            anatomy={anatomy}
            benchmark={benchmark}
            whatIf={whatIf}
            own={own}
          />
          )}
          <CostAnatomy
            anatomy={anatomy}
            benchmark={benchmark}
            burn={burnRate(
              stats.byDay.map((d) => ({ day: d.day, costUsd: d.cost })),
            )}
            whatIf={whatIf}
          />
        </>
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- blocks */

function Block({
  block,
  stats,
  recent,
  plans,
  own,
}: {
  block: BlockKey;
  stats: UserStats;
  recent: UserStats["byDay"];
  prefs: ProfilePrefs;
  plans: Plan[];
  own?: boolean;
}) {
  switch (block) {
    case "activity":
      return (
        <section>
          <Heatmap
            days={stats.byDay.map((point) => ({
              day: point.day,
              cost: point.cost,
              requests: point.requests,
            }))}
          />
        </section>
      );

    case "spend":
      return (
        <Labelled
          label="spend"
          value={money(stats.totals.cost, 2)}
          from={recent[0]?.day}
        >
          <AreaChart
            points={recent.map((point) => ({
              day: point.day,
              value: point.cost,
            }))}
            format={(value) => money(value, 2)}
          />
        </Labelled>
      );

    case "tokens":
      return (
        <Labelled
          label="tokens"
          value={`${compact(stats.totals.tokens)} tokens`}
          from={recent[0]?.day}
        >
          {/* Per day first, then the all-time split. The chart answers "when",
              the bars answer "what of" — the two together are what makes a
              spike explainable rather than just visible. */}
          <StackedDays
            days={recent.map((point) => ({
              day: point.day,
              parts: [
                { label: "cache read", value: point.cacheRead },
                { label: "cache write", value: point.cacheWrite },
                { label: "output", value: point.output },
                { label: "input", value: point.input },
              ],
            }))}
            format={(value) => `${compact(value)} tokens`}
          />
          <div style={{ marginTop: "1.1rem" }}>
            <ShareBars
              rows={[
                { label: "cache read", value: stats.tokens.cacheRead },
                { label: "cache write", value: stats.tokens.cacheWrite },
                { label: "output", value: stats.tokens.output },
                { label: "input", value: stats.tokens.input },
              ].map((row) => ({
                ...row,
                display: `${compact(row.value)} · ${percent(row.value, stats.totals.tokens)}`,
              }))}
            />
          </div>
        </Labelled>
      );

    case "models":
      return (
        <Labelled label="models" value={`${stats.byModel.length} models`}>
          <PagedBars
            rows={stats.byModel.map((point) => ({
              label: modelLabel(point.model),
              value: point.cost,
              display: `${money(point.cost, 2)} · ${percent(point.cost, stats.totals.cost)}`,
            }))}
          />
        </Labelled>
      );

    case "tools":
      return (
        <Labelled
          label="tools"
          value={`${stats.byTool.length} ${stats.byTool.length === 1 ? "tool" : "tools"}`}
        >
          <PagedBars
            rows={stats.byTool.map((point) => ({
              label: point.tool,
              value: point.cost,
              display: `${money(point.cost, 2)} · ${percent(point.cost, stats.totals.cost)}`,
            }))}
          />
        </Labelled>
      );

    case "plans":
      return plans.length > 0 ? <Plans plans={plans} stats={stats} own={own} /> : null;

    case "summary":
      return <Summary stats={stats} />;
  }
}

/* ---------------------------------------------------------------- pieces */

function Labelled({
  label,
  value,
  from,
  children,
}: {
  label: string;
  value: string;
  from?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <p className="block-label">{label}</p>
      <p className="block-value">{value}</p>
      <div style={{ marginTop: "1.25rem" }}>{children}</div>
      {from && (
        <div className="axis">
          <span>{niceDay(from)}</span>
          <span>today</span>
        </div>
      )}
    </section>
  );
}

/**
 * What this person pays for.
 *
 * The only declared section on the page, and it says so. When a price is
 * given, the interesting figure is the one underneath: a subscription set
 * against the API-rate value of the work it actually carried. That ratio is
 * the whole argument for a plan, and nobody normally gets to see it.
 */
/** Total spend over the last `days` calendar days, ending today. */
function spendSince(stats: UserStats, days: number): number {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - (days - 1));
  const from = cutoff.toISOString().slice(0, 10);

  return stats.byDay.reduce(
    (sum, point) => (point.day >= from ? sum + point.cost : sum),
    0,
  );
}

function Plans({ plans, stats, own }: { plans: Plan[]; stats: UserStats; own?: boolean }) {
  const monthly = monthlyTotal(plans);
  const priced = hasPricedPlan(plans);

  // Against the last 30 days, because a plan is billed monthly and comparing
  // it with an all-time total would flatter it by however long the account has
  // existed.
  //
  // Cut by date rather than by taking the last 30 entries: `byDay` holds only
  // the days that had usage, so on a twice-a-week account thirty entries reach
  // back four months, and the sentence below would claim they were thirty days.
  const measured = spendSince(stats, 30);

  // Only the flat fees. Someone listing a $200 subscription and an API account
  // is not getting 9x on the API account; they are paying API rates for it.
  const flat = subscriptionMonthly(plans);
  const ratio = flat > 0 ? measured / flat : 0;

  return (
    <section>
      <p className="block-label">what {own ? "you pay" : "they pay"} for</p>
      <p className="block-value">
        {priced
          ? `${money(monthly, 2)}/mo`
          : `${plans.length} ${plans.length === 1 ? "plan" : "plans"}`}
      </p>

      <ul className="plans">
        {plans.map((plan, index) => (
          <li key={`${plan.provider}-${index}`}>
            <span className="who">{providerName(plan)}</span>
            <span className="what">{plan.plan}</span>
            <span className="tag">{KIND_LABELS[plan.kind]}</span>
            <span className="cost">
              {plan.monthlyUsd === undefined
                ? ""
                : `${money(plan.monthlyUsd, 2)}/mo`}
            </span>
          </li>
        ))}
      </ul>

      {/* The verdict, not a footnote. This is the one figure here that answers
          a decision someone actually has to make each month, and it spent its
          first life as the smallest, dimmest line in the section. The
          arithmetic below it stays quiet; the answer does not. */}
      {/* Owner only. The plan list is something people choose to publish; what
          that plan returned against their real usage is a different thing, and
          a visitor reading "38% of what they pay" is reading a verdict on
          somebody's spending that was never offered to them. */}
      {own && flat > 0 && measured > 0 && (
        <>
          <p className="plan-verdict" data-good={ratio >= 1 ? "" : undefined}>
            {ratio >= 1
              ? `${ratio.toFixed(1)}× what ${own ? "you pay" : "they pay"}`
              : `${percent(measured, flat)} of what ${own ? "you pay" : "they pay"}`}
          </p>
          <p className="micro" style={{ marginTop: "0.35rem", lineHeight: 1.7 }}>
            {money(flat, 2)} a month in subscriptions against {money(measured, 2)}{" "}
            of usage in the last 30 days at API rates
            {ratio >= 1
              ? "."
              : own
                ? " — a cheaper plan may cover it."
                : "."}
          </p>
        </>
      )}

      <p
        className="micro"
        style={{ marginTop: flat > 0 && measured > 0 ? "0.35rem" : "0.9rem" }}
      >
        Self-reported. Nothing here is checked against a provider.
      </p>
    </section>
  );
}

function Stat({ k, v, idle }: { k: string; v: string; idle?: boolean }) {
  return (
    <div className="stat">
      <span className="k">{k}</span>
      <span className={`v${idle ? " idle" : ""}`}>{v}</span>
    </div>
  );
}

/** One headline figure, chosen by the profile's owner. */
function statValue(
  key: StatKey,
  stats: UserStats,
  hasUsage: boolean,
  plans: Plan[],
): { v: string; idle?: boolean } {
  const dash = { v: "—", idle: true };
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
      return {
        v: money(stats.totals.cost / Math.max(stats.totals.days, 1), 2),
      };
    case "perRequest":
      return {
        v: money(stats.totals.cost / Math.max(stats.totals.requests, 1)),
      };
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

function Summary({ stats }: { stats: UserStats }) {
  const rows: [string, string][] = [
    ["requests", count(stats.totals.requests)],
    ["active days", count(stats.totals.days)],
    [
      "per active day",
      money(stats.totals.cost / Math.max(stats.totals.days, 1), 2),
    ],
    [
      "per request",
      money(stats.totals.cost / Math.max(stats.totals.requests, 1)),
    ],
    [
      "tokens per request",
      compact(stats.totals.tokens / Math.max(stats.totals.requests, 1)),
    ],
    ["biggest day", stats.best ? money(stats.best.cost, 2) : "—"],
    ["first reported", stats.firstDay ? niceDay(stats.firstDay) : "—"],
    ["last reported", stats.lastDay ? sinceDay(stats.lastDay) : "—"],
  ];

  return (
    <section>
      <p className="block-label" style={{ marginBottom: "0.75rem" }}>
        summary
      </p>
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(15rem, 1fr))",
          gap: "0 2.5rem",
        }}
      >
        {rows.map(([key, value]) => (
          <div
            key={key}
            style={{
              display: "flex",
              justifyContent: "space-between",
              gap: "1rem",
              padding: "0.5rem 0",
              fontSize: "0.8125rem",
            }}
          >
            <dt className="sub" style={{ margin: 0 }}>
              {key}
            </dt>
            <dd style={{ margin: 0 }}>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
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
