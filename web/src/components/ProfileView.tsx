import Link from "next/link";
import { AreaChart, ShareBars, StackedDays } from "@/components/Charts";
import { PagedBars } from "@/components/PagedBars";
import { Avatar } from "@/components/Avatar";
import { ModelLogo, ToolLogo } from "@/components/BrandLogo";
import { Heatmap } from "@/components/Heatmap";
import type { LogoMap } from "@/lib/logos";
import { resolveModelLogos } from "@/lib/logos-server";
import { ShareButton } from "@/components/ShareButton";
import { SocialIcon } from "@/components/SocialIcon";
import {
  compact,
  count,
  money,
  niceDay,
  percent,
  relative,
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
  BLOCK_LABELS,
  OFFERED_BLOCKS,
  STAT_LABELS,
  lookOf,
  type LayoutEdit,
  parsePrefs,
  type LookKey,
  type BlockKey,
  type ProfilePrefs,
  type StatKey,
} from "@/lib/prefs";
import { DailySpend } from "@/components/DailySpend";
import { changeLayout } from "@/app/profile/actions";
import {
  rankOf,
  rankedUsers,
  shiftDay,
  today,
  syncInfo,
  userStats,
  type SyncInfo,
  type UserStats,
} from "@/lib/stats";
import {
  WEEKDAYS,
  activeShare,
  byWeekday,
  cacheHitRate,
  peaks,
  window,
} from "@/lib/profile-stats";
import { Cells, type Cell } from "@/components/Cells";
import { Breakdown, Columns, Figures, SplitBar } from "@/components/ProfileLooks";
import { CostAnatomy } from "@/components/CostAnatomy";
import { Savings } from "@/components/Savings";
import {
  anatomyFor,
  burnRate,
  reuseBenchmark,
  whatIf as whatIfFor,
  type Anatomy,
  type ReuseBenchmark,
  type WhatIf,
} from "@/lib/backend";

/**
 * The profile, shared by /profile/[handle] and /account.
 *
 * A profile header, section navigation and a responsive grid of usage panels.
 * Saved section order, widths and looks are shared with the account page.
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
  customise = false,
  back,
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
  /**
   * The owner's in-place layout mode: every section grows hide, move and
   * width controls, and the hidden ones are listed to bring back.
   */
  customise?: boolean;
  /** The page's own path, where a layout edit returns to. */
  back?: string;
}) {
  // Fetched together: four round trips in series would be felt, and the
  // anatomy needs the same rows the summary already walks.
  const [stats, anatomy, whatIf, sync, standing] = await Promise.all([
    userStats(user.id, "all"),
    anatomyFor(user.id),
    whatIfFor(user.id),
    syncInfo(user.id),
    standingFor(user.id, rank),
  ]);
  const benchmark = await reuseBenchmark(user.id, anatomy);
  const logoMap = await resolveModelLogos([
    ...stats.byModel.map((m) => m.model),
    ...stats.byDay.flatMap((d) => (d.models ?? []).map((m) => m.model)),
    ...(whatIf?.rows ?? []).map((r) => r.model),
    ...(whatIf?.actualModels ?? []),
  ]);
  const prefs = parsePrefs(user.prefs);
  const links = parseLinks(user.links);
  const plans = parsePlans(user.plans);
  const hasUsage = stats.totals.requests > 0;
  const recent = stats.byDay.filter((point) => point.day >= shiftDay(today(), -(WINDOW_DAYS - 1)));
  // Removed sections never get this far: parsePrefs drops them.
  const visibleBlocks = prefs.blocks.filter((block) =>
    block === "standing" ? standing !== null : block === "plans" ? plans.length > 0 : true,
  );
  const destinations: { label: string; blocks: BlockKey[] }[] = [
    { label: "Overview", blocks: ["figures", "lately", "standing"] },
    { label: "Activity", blocks: ["activity", "records", "rhythm"] },
    { label: "Usage", blocks: ["spend", "tokens", "models", "tools"] },
    { label: "Details", blocks: ["plans", "summary"] },
  ];
  const navigation = destinations.flatMap(({ label, blocks }) => {
    const target = visibleBlocks.find((block) => blocks.includes(block));
    return target ? [{ label, target }] : [];
  });

  return (
    <div className="profile-page" data-accent={prefs.accent}>
      {identity && (
        <header className="profile-intro">
          <div className="profile-intro-top">
            <div className="profile-head">
              <Avatar handle={user.handle} size={52} style={prefs.avatar} url={user.avatarUrl} />
              <div className="profile-who">
                <h1 className="profile-name">{user.name?.trim() || user.handle}</h1>
                <div className="profile-handle">
                  <span>@{user.handle}</span>
                  {user.billing === "subscription" && <span className="tag">plan</span>}
                  {rank && <Link href="/" className="tag on link" aria-label={`Leaderboard rank ${rank}`}>#{rank}</Link>}
                  {own && !user.isPublic && <span className="tag">private</span>}
                  {own && user.isPublic && !user.listed && <span className="tag">unlisted</span>}
                </div>
              </div>
            </div>
            <div className="profile-actions">
              <ShareButton handle={user.handle} />
              {own && <Link href="/account/settings" className="btn">edit profile</Link>}
            </div>
          </div>
          {user.bio && <p className="profile-bio">{user.bio}</p>}
          <div className="profile-meta">
            <span>joined {sinceJoin(user.createdAt)}</span>
            {links.length > 0 && (
              <div className="links">
                {links.map((link) => (
                  <a key={link.url} href={link.url} target="_blank" rel="me noreferrer noopener">
                    <SocialIcon provider={link.provider} size={13} />{link.label}
                  </a>
                ))}
              </div>
            )}
            {own && links.length === 0 && (
              <Link href="/account/settings" className="link">+ add a social link</Link>
            )}
          </div>
        </header>
      )}

      <div className="profile-toolbar">
        <div>
          <h2 className="profile-title">{identity ? "Usage overview" : "Your usage"}</h2>
          <p className="micro">All-time totals · last sync {relative(sync.lastSyncAt)}</p>
        </div>
        {own && (
          <div className="customise-bar">
            {customise ? (
              <>
                <span className="micro">
                  hide, move or resize sections · change looks in{" "}
                  <Link href="/account/settings#sections" className="link">settings</Link>
                </span>
                <Link href="?" className="btn primary" scroll={false}>done</Link>
              </>
            ) : (
              <Link href="?customise=1" className="btn" scroll={false}>customise layout</Link>
            )}
          </div>
        )}

      </div>

      {hasUsage && navigation.length > 0 && (
        <nav className="profile-sections" aria-label="Profile sections">
          {navigation.map(({ label, target }) => (
            <a key={target} href={`#${target}`}>{label}</a>
          ))}
        </nav>
      )}

      {!hasUsage ? (
        <>
          {prefs.blocks.includes("figures") && (
            <div className="pblocks" data-customise={customise ? "" : undefined}>
              <div className="pblock" id="figures" data-block="figures" role="region" aria-label="Headline figures">
                {customise && back && <SectionTools block="figures" back={back} first={prefs.blocks[0] === "figures"} last={prefs.blocks.at(-1) === "figures"} half={prefs.half.includes("figures")} />}
                <HeadlineFigures prefs={prefs} stats={stats} hasUsage={false} plans={plans} />
              </div>
            </div>
          )}
          <p className="profile-empty">
            {own ? (
              <>
                No usage reported yet. <Link href="/link" className="link">Connect a machine</Link> and run{" "}
                <span className="kbd">tokn sync</span>.
              </>
            ) : (
              "This account has not reported any usage yet."
            )}
          </p>
          {/* Declared, not measured, so it stands on its own: someone who has
              listed their plans but not synced yet still has something to
              show, and hiding it would be the one section that needs no data
              waiting on data. */}
          {plans.length > 0 && prefs.blocks.includes("plans") && (
            <div className="pblocks" data-customise={customise ? "" : undefined}>
              <div className="pblock" id="plans" data-block="plans" role="region" aria-label="Plans">
                {customise && back && <SectionTools block="plans" back={back} first={prefs.blocks[0] === "plans"} last={prefs.blocks.at(-1) === "plans"} half={prefs.half.includes("plans")} />}
                <Plans plans={plans} stats={stats} own={own} />
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          <div className="pblocks" data-customise={customise ? "" : undefined}>
            {layout(visibleBlocks, prefs.half).map(({ block, half }, index, all) => (
              <div
                key={block}
                id={block}
                className="pblock"
                role="region"
                aria-label={BLOCK_LABELS[block]}
                data-block={block}
                data-half={half ? "" : undefined}
              >
                {customise && back && (
                  <SectionTools
                    block={block}
                    back={back}
                    first={index === 0}
                    last={index === all.length - 1}
                    half={prefs.half.includes(block)}
                  />
                )}
                <Block
                  block={block}
                  stats={stats}
                  recent={recent}
                  prefs={prefs}
                  plans={plans}
                  own={own}
                  sync={sync}
                  standing={standing}
                  costs={{ anatomy, benchmark, whatIf }}
                  logoMap={logoMap}
                />
              </div>
            ))}
          </div>

        </>
      )}
      {hasUsage && visibleBlocks.length === 0 && (
        <p className="profile-empty">{own ? "All sections are hidden. Use customise layout to bring them back." : "No usage sections to display."}</p>
      )}
      {customise && back && <HiddenSections prefs={prefs} back={back} />}
    </div>
  );
}

/* ---------------------------------------------------------------- blocks */

/**
 * Pair half-width blocks two to a row, in the owner's order.
 *
 * A half block with no half neighbour to sit beside is drawn full width
 * rather than leaving an empty column next to it. Pairing by order, not by
 * `grid-auto-flow: dense`, keeps the page in the order the owner chose.
 */
function layout(
  blocks: BlockKey[],
  half: BlockKey[],
): { block: BlockKey; half: boolean }[] {
  const out: { block: BlockKey; half: boolean }[] = [];
  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]!;
    const next = blocks[index + 1];
    if (half.includes(block) && next && half.includes(next)) {
      out.push({ block, half: true }, { block: next, half: true });
      index++;
    } else {
      out.push({ block, half: false });
    }
  }
  return out;
}

function Block({
  block,
  stats,
  recent,
  prefs,
  plans,
  own,
  sync,
  standing,
  costs,
  logoMap,
}: {
  block: BlockKey;
  stats: UserStats;
  recent: UserStats["byDay"];
  prefs: ProfilePrefs;
  plans: Plan[];
  own?: boolean;
  sync: SyncInfo;
  standing: Standing | null;
  costs: { anatomy: Anatomy; benchmark: ReuseBenchmark; whatIf: WhatIf | null };
  logoMap: LogoMap;
}) {
  switch (block) {
    case "figures":
      return <HeadlineFigures prefs={prefs} stats={stats} hasUsage plans={plans} />;

    case "lately":
      return <Lately stats={stats} look={lookOf(prefs, "lately")} />;

    case "standing":
      return standing ? (
        <StandingBlock standing={standing} look={lookOf(prefs, "standing")} />
      ) : null;

    case "records":
      return <Records stats={stats} look={lookOf(prefs, "records")} />;

    case "rhythm":
      return <Rhythm stats={stats} look={lookOf(prefs, "rhythm")} />;

    case "costs": {
      const compactLook = lookOf(prefs, "costs") === "compact";
      return (
        <>
          {/* Owner only. "What you could have spent less" is a statement
              about somebody's money and their judgement, and a leaderboard
              visitor has no business reading either. */}
          {own && !compactLook && <Savings {...costs} own />}
          <CostAnatomy {...costs} own={own} compact={compactLook} logoMap={logoMap} />
        </>
      );
    }

    case "activity":
      return <Activity stats={stats} look={lookOf(prefs, "activity")} />;

    case "spend": {
      const look = lookOf(prefs, "spend");
      return (
        <DailySpend
          today={today()}
          chart={look === "line" ? "line" : "bars"}
          list={look !== "compact"}
          logoMap={logoMap}
          days={stats.byDay.map((point) => ({
            day: point.day,
            cost: point.cost,
            tokens: point.tokens,
            requests: point.requests,
            input: point.input,
            output: point.output,
            cacheRead: point.cacheRead,
            cacheWrite: point.cacheWrite,
            models: (point.models ?? []).map((m) => ({
              model: m.model,
              label: modelLabel(m.model),
              cost: m.cost,
            })),
          }))}
        />
      );
    }

    case "tokens": {
      const look = lookOf(prefs, "tokens");
      const parts = [
        { label: "cache read", value: stats.tokens.cacheRead },
        { label: "cache write", value: stats.tokens.cacheWrite },
        { label: "output", value: stats.tokens.output },
        { label: "input", value: stats.tokens.input },
      ];

      if (look === "split") {
        return (
          <Labelled label="tokens" value={`${compact(stats.totals.tokens)} tokens`}>
            <SplitBar parts={parts} format={(value) => compact(value)} />
          </Labelled>
        );
      }

      if (look === "table") {
        return (
          <Labelled label="tokens" value={`${compact(stats.totals.tokens)} tokens`}>
            <div className="table-wrap">
              <table className="whatif">
                <thead>
                  <tr>
                    <th>kind</th>
                    <th className="r">tokens</th>
                    <th className="r">share</th>
                    <th className="r">per request</th>
                  </tr>
                </thead>
                <tbody>
                  {parts.map((part) => (
                    <tr key={part.label}>
                      <td>{part.label}</td>
                      <td className="r">{compact(part.value)}</td>
                      <td className="r sub">{percent(part.value, stats.totals.tokens)}</td>
                      <td className="r sub">
                        {compact(part.value / Math.max(stats.totals.requests, 1))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Labelled>
        );
      }

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
              rows={parts.map((row) => ({
                ...row,
                display: `${compact(row.value)} · ${percent(row.value, stats.totals.tokens)}`,
              }))}
            />
          </div>
        </Labelled>
      );
    }

    case "models":
      return (
        <Labelled label="models" value={`${stats.byModel.length} ${stats.byModel.length === 1 ? "model" : "models"}`}>
          <Breakdown
            noun="model"
            look={lookOf(prefs, "models")}
            rows={stats.byModel.map((point) => ({
              key: point.model,
              label: modelLabel(point.model),
              cost: point.cost,
              tokens: point.tokens,
              requests: point.requests,
              icon: <ModelLogo model={point.model} logoMap={logoMap} />,
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
          <Breakdown
            noun="tool"
            look={lookOf(prefs, "tools")}
            rows={stats.byTool.map((point) => ({
              key: point.tool,
              label: point.tool,
              cost: point.cost,
              tokens: point.tokens,
              requests: point.requests,
              icon: <ToolLogo tool={point.tool} />,
            }))}
          />
        </Labelled>
      );

    case "plans":
      return plans.length > 0 ? <Plans plans={plans} stats={stats} own={own} /> : null;

    case "summary":
      return <Summary stats={stats} sync={sync} look={lookOf(prefs, "summary")} />;
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

function Summary({
  stats,
  sync,
  look,
}: {
  stats: UserStats;
  sync: SyncInfo;
  look: LookKey<"summary">;
}) {
  const share = activeShare(stats.byDay);
  const hit = cacheHitRate(stats.tokens);
  const perRequest = (n: number) => n / Math.max(stats.totals.requests, 1);

  const rows: [string, string][] = [
    ["requests", count(stats.totals.requests)],
    [
      "active days",
      share
        ? `${count(share.active)} of ${count(share.span)}`
        : count(stats.totals.days),
    ],
    [
      "per active day",
      money(stats.totals.cost / Math.max(stats.totals.days, 1), 2),
    ],
    ["per request", money(perRequest(stats.totals.cost))],
    ["tokens per request", compact(perRequest(stats.totals.tokens))],
    ["output per request", compact(perRequest(stats.tokens.output))],
    ["cache hit rate", hit === null ? "—" : percent(hit, 1)],
    ["first reported", stats.firstDay ? niceDay(stats.firstDay) : "—"],
    // The sync time, when there is one, says more than the last day with
    // usage: a quiet weekend still syncs.
    [
      "last synced",
      sync.lastSyncAt
        ? relative(sync.lastSyncAt)
        : stats.lastDay
          ? sinceDay(stats.lastDay)
          : "—",
    ],
  ];

  if (look !== "grid") {
    return (
      <section>
        <p className="block-label">summary</p>
        <Figures
          look={look}
          items={rows.map(([k, v]) => ({ k, v, idle: v === "—" }))}
        />
      </section>
    );
  }

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

/* ----------------------------------------------------------- new blocks */

/** "+23%", "−8%", or nothing when there is no earlier period to compare. */
function change(value: number | null, against: string): string | undefined {
  if (value === null) return undefined;
  const rounded = Math.round(value);
  if (rounded === 0) return `flat on ${against}`;
  return `${rounded > 0 ? "+" : "−"}${Math.abs(rounded)}% on ${against}`;
}

/** Recent spend against the period before it, and where the month is heading. */
function Lately({ stats, look }: { stats: UserStats; look: LookKey<"lately"> }) {
  const week = window(stats.byDay, 7);
  const month = window(stats.byDay, 30);
  const burn = burnRate(
    stats.byDay.map((point) => ({ day: point.day, costUsd: point.cost })),
  );

  const cells: Cell[] = [
    {
      k: "last 7 days",
      v: money(week.cost, 2),
      note: change(week.change, "the week before"),
    },
    {
      k: "last 30 days",
      v: money(month.cost, 2),
      note: change(month.change, "the 30 before"),
    },
    {
      k: "per day, 30d",
      v: money(month.cost / 30, 2),
      note: "quiet days included",
    },
    {
      k: "this month",
      v: money(burn.monthToDate, 2),
      note:
        burn.projected === null
          ? undefined
          : `on pace for ${money(burn.projected)}`,
    },
  ];

  if (look === "headline") {
    // One figure leads, its last 30 days drawn under it, and the rest follow
    // as a list. Dense over the window: a quiet day is a real zero.
    const points = Array.from({ length: 30 }, (_, index) => {
      const day = shiftDay(today(), index - 29);
      return { day, value: stats.byDay.find((point) => point.day === day)?.cost ?? 0 };
    });
    return (
      <section>
        <p className="block-label">last 30 days</p>
        <p className="headline-figure">{money(month.cost, 2)}</p>
        {cells[1]!.note && <p className="micro">{cells[1]!.note}</p>}
        <div style={{ marginTop: "0.9rem" }}>
          <AreaChart points={points} format={(value) => money(value, 2)} height={70} />
        </div>
        <div style={{ marginTop: "1rem" }}>
          <Figures look="list" items={[cells[0]!, cells[2]!, cells[3]!]} />
        </div>
      </section>
    );
  }

  return (
    <section>
      <p className="block-label">lately</p>
      <Figures items={cells} look={look} />
    </section>
  );
}

interface Standing {
  week: number | null;
  month: number | null;
  all: number | null;
  tokens: number | null;
  ranked: number;
}

/**
 * Where this account sits on the board, beyond the one all-time rank in the
 * header. Null for anyone the board does not list.
 */
async function standingFor(
  userId: string,
  rank: number | null,
): Promise<Standing | null> {
  if (rank === null) return null;
  const [week, month, tokens, ranked] = await Promise.all([
    rankOf(userId, "week", "cost"),
    rankOf(userId, "month", "cost"),
    rankOf(userId, "all", "tokens"),
    rankedUsers(),
  ]);
  return { week, month, all: rank, tokens, ranked };
}

function StandingBlock({
  standing,
  look,
}: {
  standing: Standing;
  look: LookKey<"standing">;
}) {
  const place = (k: string, value: number | null, note: string): Cell =>
    value === null
      ? { k, v: "—", idle: true, note: "no usage in this window" }
      : { k, v: `#${count(value)}`, note };

  return (
    <section>
      <p className="block-label">rank</p>
      <Figures
        look={look}
        items={[
          place("this week", standing.week, "by spend"),
          place("last 30 days", standing.month, "by spend"),
          place("all time", standing.all, `of ${count(standing.ranked)}`),
          place("tokens, all time", standing.tokens, "by volume"),
        ]}
      />
    </section>
  );
}

/** Personal bests, each with the day it happened. */
function Records({ stats, look }: { stats: UserStats; look: LookKey<"records"> }) {
  const best = peaks(stats.byDay);
  const peak = (
    k: string,
    found: { value: number; day: string } | null,
    show: (value: number) => string,
    when: (day: string) => string = niceDay,
  ): Cell =>
    found
      ? { k, v: show(found.value), note: when(found.day) }
      : { k, v: "—", idle: true };

  return (
    <section>
      <p className="block-label">records</p>
      <Figures
        look={look}
        items={[
          peak("biggest day", best.cost, (v) => money(v, 2)),
          peak("biggest week", best.week, (v) => money(v, 2), (day) => `week of ${niceDay(day)}`),
          peak("most tokens", best.tokens, (v) => `${compact(v)}`),
          peak("most requests", best.requests, (v) => count(v)),
        ]}
      />
    </section>
  );
}

const WEEKDAY_NAMES = [
  "Mondays",
  "Tuesdays",
  "Wednesdays",
  "Thursdays",
  "Fridays",
  "Saturdays",
  "Sundays",
];

/** Spend by day of the week: when the work actually happens. */
function Rhythm({ stats, look }: { stats: UserStats; look: LookKey<"rhythm"> }) {
  const totals = byWeekday(stats.byDay);
  const sum = totals.reduce((acc, value) => acc + value, 0);
  if (sum <= 0) return null;

  const max = Math.max(...totals);
  const busiest = totals.indexOf(max);

  return (
    <section>
      <p className="block-label">by weekday</p>
      <p className="block-value">{WEEKDAY_NAMES[busiest]}</p>
      {look === "bars" ? (
        <div style={{ marginTop: "1.1rem" }}>
          <ShareBars
            rows={totals.map((value, index) => ({
              label: WEEKDAYS[index]!,
              value,
              display: `${money(value, 2)} · ${percent(value, sum)}`,
            }))}
          />
        </div>
      ) : (
        <Columns
          rows={totals.map((value, index) => ({ label: WEEKDAYS[index]!, value }))}
          format={(value) => money(value, 2)}
        />
      )}
    </section>
  );
}

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** When someone works: the squares, twelve monthly totals, or the plain counts. */
function Activity({ stats, look }: { stats: UserStats; look: LookKey<"activity"> }) {
  if (look === "squares") {
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
  }

  // The last twelve calendar months, this one included, quiet ones as zero.
  const now = today();
  const months = Array.from({ length: 12 }, (_, index) => {
    const date = new Date(`${now.slice(0, 7)}-01T00:00:00Z`);
    date.setUTCMonth(date.getUTCMonth() - (11 - index));
    return date.toISOString().slice(0, 7);
  });
  const byMonth = new Map<string, number>();
  for (const point of stats.byDay) {
    const month = point.day.slice(0, 7);
    byMonth.set(month, (byMonth.get(month) ?? 0) + point.cost);
  }

  if (look === "months") {
    const best = [...byMonth.entries()].sort((a, b) => b[1] - a[1])[0];
    return (
      <section>
        <p className="block-label">by month</p>
        <p className="block-value">
          {best ? `${MONTH_NAMES[Number(best[0].slice(5)) - 1]} ${best[0].slice(0, 4)}` : "—"}
        </p>
        <Columns
          rows={months.map((month) => ({
            label: MONTH_NAMES[Number(month.slice(5)) - 1]!,
            value: byMonth.get(month) ?? 0,
          }))}
          format={(value) => money(value, 2)}
        />
      </section>
    );
  }

  const share = activeShare(stats.byDay);
  const busiest = [...byMonth.entries()].sort((a, b) => b[1] - a[1])[0];
  return (
    <section>
      <p className="block-label">activity</p>
      <Cells
        items={[
          {
            k: "active days",
            v: count(stats.totals.days),
            note: share ? `of ${count(share.span)} since the first` : undefined,
          },
          { k: "current streak", v: `${stats.streak}d`, idle: stats.streak === 0 },
          { k: "longest streak", v: `${stats.longestStreak}d` },
          {
            k: "busiest month",
            v: busiest ? money(busiest[1], 2) : "—",
            note: busiest
              ? `${MONTH_NAMES[Number(busiest[0].slice(5)) - 1]} ${busiest[0].slice(0, 4)}`
              : undefined,
          },
        ]}
      />
    </section>
  );
}

/** The owner's four chosen headline figures, large or as small cells. */
function HeadlineFigures({
  prefs,
  stats,
  hasUsage,
  plans,
}: {
  prefs: ProfilePrefs;
  stats: UserStats;
  hasUsage: boolean;
  plans: Plan[];
}) {
  const values = prefs.stats.map((key) => ({
    key,
    ...statValue(key, stats, hasUsage, plans),
  }));

  if (lookOf(prefs, "figures") === "small") {
    return (
      <section>
        <Cells items={values.map(({ key, v, idle }) => ({ k: STAT_LABELS[key], v, idle }))} />
      </section>
    );
  }

  return (
    <section className="stats">
      {values.map(({ key, v, idle }) => (
        <Stat key={key} k={STAT_LABELS[key]} v={v} idle={idle} />
      ))}
    </section>
  );
}

/* ------------------------------------------------------------- customise */

/**
 * The controls above a section while its owner is customising. Plain forms,
 * one per button, so each works without the page's JavaScript.
 */
function SectionTools({
  block,
  back,
  first,
  last,
  half,
}: {
  block: BlockKey;
  back: string;
  first: boolean;
  last: boolean;
  half: boolean;
}) {
  const label = BLOCK_LABELS[block];
  const button = (edit: LayoutEdit, text: string, aria: string, disabled = false) => (
    <form action={changeLayout}>
      <input type="hidden" name="edit" value={edit} />
      <input type="hidden" name="block" value={block} />
      <input type="hidden" name="back" value={back} />
      <button type="submit" className="ptool" aria-label={aria} disabled={disabled}>
        {text}
      </button>
    </form>
  );

  return (
    <div className="ptools">
      <span className="ptools-name">{label}</span>
      {button("up", "↑", `move ${label} up`, first)}
      {button("down", "↓", `move ${label} down`, last)}
      {button("width", half ? "full width" : "half width", `make ${label} ${half ? "full" : "half"} width`)}
      {button("hide", "hide", `hide ${label}`)}
    </div>
  );
}

/** Sections the owner has hidden, each one click from coming back. */
function HiddenSections({ prefs, back }: { prefs: ProfilePrefs; back: string }) {
  const hidden = OFFERED_BLOCKS.filter((block) => !prefs.blocks.includes(block));
  return (
    <section className="hidden-sections">
      <p className="block-label">hidden sections</p>
      {hidden.length === 0 ? (
        <p className="micro" style={{ marginTop: "0.5rem" }}>
          nothing hidden · every available section is on your profile
        </p>
      ) : (
        <div className="hidden-list">
          {hidden.map((block) => (
            <form key={block} action={changeLayout}>
              <input type="hidden" name="edit" value="show" />
              <input type="hidden" name="block" value={block} />
              <input type="hidden" name="back" value={back} />
              <button type="submit" className="btn" aria-label={`show ${BLOCK_LABELS[block]}`}>
                + {BLOCK_LABELS[block]}
              </button>
            </form>
          ))}
        </div>
      )}
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
