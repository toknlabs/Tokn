import { loadConfig } from "../core/config.js";
import { currentPricing } from "../core/pricing-refresh.js";
import { NoSessionsError, runScan, toolName, type ScanResult } from "../core/run-scan.js";
import { unreadable } from "../core/sources/registry.js";
import { totalTokens } from "../core/pricing.js";
import { bold, dim, sym, yellow } from "../ui/ansi.js";
import { compactNumber, duration, fullNumber, pluralize, shortModel, usd } from "../ui/format.js";
import { renderTable } from "../ui/table.js";
import { resolveSince, type ParsedArgs } from "../args.js";

/** `tokn scan` — read local sessions and report usage without uploading. */

export async function scanCommand(args: ParsedArgs): Promise<number> {
  const config = await loadConfig();
  const json = args.flags.json === true;

  let result: ScanResult;
  try {
    result = await runScan({
      since: resolveSince(args),
      pricing: await currentPricing(config),
      only: typeof args.flags.tool === "string" ? [args.flags.tool] : undefined,
      quiet: json,
    });
  } catch (error) {
    if (error instanceof NoSessionsError) {
      reportNoSessions();
      return 1;
    }
    throw error;
  }

  if (json) {
    process.stdout.write(JSON.stringify(toJson(result), null, 2) + "\n");
    return 0;
  }

  const view = args.flags.days === true ? "days" : args.flags.tools === true ? "tools" : "models";
  renderReport(result, { view });

  process.stdout.write(
    `\n  ${dim("Run")} ${bold("tokn sync")} ${dim("to publish to the leaderboard.")}\n\n`,
  );
  return 0;
}

export function renderReport(
  result: ScanResult,
  options: { view?: "models" | "days" | "tools" } = {},
): void {
  const out = process.stdout;
  const { aggregation } = result;

  if (aggregation.totals.requests === 0) {
    out.write(`\n  ${yellow(sym.bullet)} No usage found in that range.\n\n`);
    writeUnreadable(result);
    return;
  }

  out.write("\n");
  out.write(
    options.view === "days"
      ? renderDayTable(result)
      : options.view === "tools"
        ? renderToolTable(result)
        : renderModelTable(result),
  );
  out.write("\n\n");

  writeFooter(result);
}

function writeFooter(result: ScanResult): void {
  const out = process.stdout;
  const { aggregation } = result;

  const readable = result.sources.filter((s) => s.availability.state === "ready");
  const toolList = readable.map((s) => s.source.name).join(" + ");

  const range =
    aggregation.firstDay && aggregation.lastDay && aggregation.firstDay !== aggregation.lastDay
      ? `${formatDay(aggregation.firstDay)} – ${formatDay(aggregation.lastDay)}`
      : aggregation.lastDay
        ? formatDay(aggregation.lastDay)
        : "";

  const facts = [toolList, range, duration(result.elapsedMs)].filter(Boolean);
  out.write(`  ${dim(facts.join(` ${sym.bullet} `))}\n`);

  // Duplicates are the difference between this tool and a naive one, so the
  // number is worth stating rather than hiding.
  const duplicates = result.sources.reduce((sum, s) => sum + s.stats.duplicates, 0);
  if (duplicates > 0) {
    out.write(
      `  ${dim(`Ignored ${fullNumber(duplicates)} duplicate ${pluralize(duplicates, "record")} from resumed sessions.`)}\n`,
    );
  }

  if (aggregation.unknownModels.length > 0) {
    const shown = aggregation.unknownModels.slice(0, 4).join(", ");
    const more = aggregation.unknownModels.length > 4 ? `, +${aggregation.unknownModels.length - 4} more` : "";
    out.write(
      `  ${yellow(sym.bullet)} ${dim(`No pricing for ${shown}${more} — tokens counted, cost excluded.`)}\n`,
    );
  }

  const failures = result.sources.reduce((sum, s) => sum + s.stats.failures, 0);
  if (failures > 0) {
    out.write(`  ${dim(`${failures} ${pluralize(failures, "file")} could not be read.`)}\n`);
  }

  writeUnreadable(result);
}

/**
 * Tools we found but cannot account for. Saying so matters: a leaderboard that
 * silently counts a tool as zero gives the user no way to tell "unused" apart
 * from "unreadable".
 */
function writeUnreadable(result: ScanResult): void {
  const out = process.stdout;
  const blocked = unreadable(result.sources);
  if (blocked.length === 0) return;

  out.write(`\n  ${dim("Detected but not counted:")}\n`);
  for (const tool of blocked) {
    out.write(`    ${dim(`${tool.name} — ${tool.reason}`)}\n`);
  }
}

function renderModelTable(result: ScanResult): string {
  const { byModel, totals } = result.aggregation;

  const rows = byModel.map((entry) => [
    shortModel(entry.model),
    fullNumber(entry.requests),
    compactNumber(entry.tokens.input),
    compactNumber(entry.tokens.output),
    compactNumber(entry.tokens.cacheWrite5m + entry.tokens.cacheWrite1h),
    compactNumber(entry.tokens.cacheRead),
    entry.unpriced ? dim("—") : usd(entry.cost.total),
  ]);

  rows.push([
    bold("TOTAL"),
    bold(fullNumber(totals.requests)),
    bold(compactNumber(totals.tokens.input)),
    bold(compactNumber(totals.tokens.output)),
    bold(compactNumber(totals.tokens.cacheWrite5m + totals.tokens.cacheWrite1h)),
    bold(compactNumber(totals.tokens.cacheRead)),
    bold(usd(totals.cost.total)),
  ]);

  return renderTable(
    [
      { header: "model" },
      { header: "requests", align: "right" },
      { header: "input", align: "right" },
      { header: "output", align: "right" },
      { header: "cache w", align: "right" },
      { header: "cache r", align: "right" },
      { header: "cost", align: "right" },
    ],
    rows,
    { ruleBeforeLast: true },
  );
}

function renderToolTable(result: ScanResult): string {
  const { byTool, totals } = result.aggregation;

  const rows = byTool.map((entry) => [
    toolName(entry.tool, result.sources),
    fullNumber(entry.models),
    fullNumber(entry.requests),
    compactNumber(totalTokens(entry.tokens)),
    entry.unpriced && entry.cost.total === 0 ? dim("—") : usd(entry.cost.total),
  ]);

  rows.push([
    bold("TOTAL"),
    "",
    bold(fullNumber(totals.requests)),
    bold(compactNumber(totalTokens(totals.tokens))),
    bold(usd(totals.cost.total)),
  ]);

  return renderTable(
    [
      { header: "tool" },
      { header: "models", align: "right" },
      { header: "requests", align: "right" },
      { header: "tokens", align: "right" },
      { header: "cost", align: "right" },
    ],
    rows,
    { ruleBeforeLast: true },
  );
}

function renderDayTable(result: ScanResult): string {
  const { byDay, totals } = result.aggregation;
  const recent = byDay.slice(-30);

  const rows = recent.map((entry) => [
    formatDay(entry.day),
    fullNumber(entry.requests),
    compactNumber(totalTokens(entry.tokens)),
    usd(entry.cost.total),
  ]);

  rows.push([
    bold(byDay.length > recent.length ? `TOTAL ${dim(`(all ${byDay.length} days)`)}` : "TOTAL"),
    bold(fullNumber(totals.requests)),
    bold(compactNumber(totalTokens(totals.tokens))),
    bold(usd(totals.cost.total)),
  ]);

  return renderTable(
    [
      { header: "day" },
      { header: "requests", align: "right" },
      { header: "tokens", align: "right" },
      { header: "cost", align: "right" },
    ],
    rows,
    { ruleBeforeLast: true },
  );
}

function formatDay(day: string): string {
  if (day === "unknown") return day;
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function reportNoSessions(): void {
  const out = process.stdout;
  out.write(`\n  ${yellow(sym.bullet)} No AI CLI sessions found on this machine.\n\n`);
  out.write(`  ${dim("tokn reads usage written by Claude Code, Claude Desktop, Codex,")}\n`);
  out.write(`  ${dim("GitHub Copilot CLI and opencode.")}\n`);
  out.write(`  ${dim("If your Claude config lives elsewhere, set CLAUDE_CONFIG_DIR.")}\n\n`);
}

function toJson(result: ScanResult) {
  const { aggregation } = result;
  return {
    version: 2,
    scannedAt: new Date().toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    totals: {
      requests: aggregation.totals.requests,
      tokens: aggregation.totals.tokens,
      costUsd: Number(aggregation.totals.cost.total.toFixed(6)),
    },
    byTool: aggregation.byTool.map((entry) => ({
      tool: entry.tool,
      requests: entry.requests,
      models: entry.models,
      tokens: entry.tokens,
      costUsd: Number(entry.cost.total.toFixed(6)),
    })),
    byModel: aggregation.byModel.map((entry) => ({
      model: entry.model,
      requests: entry.requests,
      tokens: entry.tokens,
      costUsd: Number(entry.cost.total.toFixed(6)),
      unpriced: entry.unpriced,
    })),
    byDay: aggregation.byDay.map((entry) => ({
      day: entry.day,
      requests: entry.requests,
      tokens: entry.tokens,
      costUsd: Number(entry.cost.total.toFixed(6)),
    })),
    unknownModels: aggregation.unknownModels,
    sources: result.sources.map((s) => ({
      id: s.source.id,
      name: s.source.name,
      state: s.availability.state,
      reason: "reason" in s.availability ? s.availability.reason : undefined,
      events: s.stats.events,
      duplicates: s.stats.duplicates,
      detail: s.stats.detail,
    })),
  };
}
