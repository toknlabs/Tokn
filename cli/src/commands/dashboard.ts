import { loadConfig, resolveToken } from "../core/config.js";
import { currentPricing } from "../core/pricing-refresh.js";
import { NoSessionsError, runScan, toolName } from "../core/run-scan.js";
import { totalTokens } from "../core/pricing.js";
import { unreadable } from "../core/sources/registry.js";
import { schedulerInstalled } from "../core/scheduler.js";
import { bold, dim, gray, green, sym, yellow } from "../ui/ansi.js";
import { compactNumber, fullNumber, relativeTime, shortModel, usd } from "../ui/format.js";
import { renderHeatmap, renderHeatmapLegend } from "../ui/heatmap.js";
import { renderLogo } from "../ui/logo.js";
import { renderTable } from "../ui/table.js";
import { resolveSince, type ParsedArgs } from "../args.js";

/**
 * `tokn` with no arguments.
 *
 * The one screen someone sees most often, so it answers the questions people
 * actually have: what have I spent, on what, how consistently, and is any of
 * this reaching the leaderboard.
 */

export async function dashboardCommand(args: ParsedArgs): Promise<number> {
  const out = process.stdout;
  const config = await loadConfig();

  let result;
  try {
    result = await runScan({
      since: resolveSince(args),
      pricing: await currentPricing(config),
    });
  } catch (error) {
    if (error instanceof NoSessionsError) {
      out.write(renderLogo({ subtitle: "track your AI coding usage" }) + "\n\n");
      out.write(`  ${yellow(sym.bullet)} No AI sessions found on this machine yet.\n\n`);
      out.write(`  ${dim("tokn reads usage written by Claude Code, Claude Desktop,")}\n`);
      out.write(`  ${dim("Codex, GitHub Copilot CLI and opencode.")}\n\n`);
      return 1;
    }
    throw error;
  }

  const { aggregation } = result;
  const linked = Boolean(resolveToken(config));

  out.write("\n" + renderLogo() + "\n\n");

  /* ------------------------------------------------------------ headline */

  const totals = aggregation.totals;
  const handle = config.user?.handle ? `@${config.user.handle}` : null;

  out.write(
    `  ${bold(usd(totals.cost.total))}  ` +
      dim(
        `${compactNumber(totalTokens(totals.tokens))} tokens · ` +
          `${fullNumber(totals.requests)} requests · ` +
          `${aggregation.byDay.length} active days`,
      ) +
      "\n",
  );

  if (handle) {
    out.write(`  ${dim("publishing as")} ${gray(handle)}\n`);
  }

  /* ------------------------------------------------------------- heatmap */

  if (aggregation.byDay.length > 0) {
    out.write("\n");
    out.write(
      renderHeatmap(
        aggregation.byDay.map((d) => ({ day: d.day, value: d.cost.total })),
      ) + "\n",
    );
    out.write(`    ${renderHeatmapLegend()}`);

    const streak = currentStreak(aggregation.byDay.map((d) => d.day));
    if (streak > 1) {
      out.write(`   ${dim(`${streak} day streak`)}`);
    }
    out.write("\n");
  }

  /* -------------------------------------------------------------- models */

  const models = aggregation.byModel.slice(0, 6);
  if (models.length > 0) {
    out.write("\n");
    const rows = models.map((entry) => [
      shortModel(entry.model),
      compactNumber(totalTokens(entry.tokens)),
      entry.unpriced ? dim("—") : usd(entry.cost.total),
      bar(entry.cost.total, models[0]?.cost.total ?? 1),
    ]);

    out.write(
      renderTable(
        [
          { header: "model" },
          { header: "tokens", align: "right" },
          { header: "cost", align: "right" },
          { header: "" },
        ],
        rows,
      ) + "\n",
    );

    if (aggregation.byModel.length > models.length) {
      out.write(
        `  ${dim(`+${aggregation.byModel.length - models.length} more · `)}${gray("tokn scan")}\n`,
      );
    }
  }

  /* --------------------------------------------------------------- tools */

  if (aggregation.byTool.length > 1) {
    out.write("\n");
    const parts = aggregation.byTool.map(
      (entry) => `${toolName(entry.tool, result.sources)} ${gray(usd(entry.cost.total))}`,
    );
    out.write(`  ${dim(parts.join(dim("  ·  ")))}\n`);
  }

  /* ------------------------------------------------------------- footer */

  out.write("\n");

  const blocked = unreadable(result.sources);
  if (blocked.length > 0) {
    out.write(`  ${dim(`not counted: ${blocked.map((b) => b.name).join(", ")}`)}\n`);
  }

  if (!linked) {
    out.write(`  ${yellow(sym.bullet)} Not linked. ${dim("Run")} ${bold("tokn setup")} ${dim("to publish to the leaderboard.")}\n\n`);
    return 0;
  }

  const auto = await schedulerInstalled();
  const synced = config.lastSyncAt ? relativeTime(config.lastSyncAt) : "never";

  out.write(
    `  ${green(sym.tick)} ${dim(`synced ${synced}`)}` +
      (auto ? dim("  ·  auto-sync on") : dim("  ·  auto-sync off")) +
      "\n",
  );
  out.write(`  ${dim("commands:")} ${gray("tokn sync")} ${dim("·")} ${gray("tokn scan --days")} ${dim("·")} ${gray("tokn --help")}\n\n`);

  return 0;
}

/** A proportional bar, for scanning the model list at a glance. */
function bar(value: number, max: number): string {
  if (max <= 0) return "";
  const width = 12;
  const filled = Math.max(1, Math.round((value / max) * width));
  return dim("▔".repeat(filled));
}

/**
 * Consecutive days up to today. Ending yesterday still counts: the day is not
 * over everywhere at once, and breaking a streak on a timezone is unkind.
 */
function currentStreak(days: string[]): number {
  if (days.length === 0) return 0;
  const set = new Set(days);

  const cursor = new Date();
  cursor.setHours(12, 0, 0, 0);

  const key = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  if (!set.has(key(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!set.has(key(cursor))) return 0;
  }

  let streak = 0;
  while (set.has(key(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}
