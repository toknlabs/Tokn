import type { UsageEvent } from "./sources/types.js";
import {
  addCost,
  addTokens,
  computeCost,
  emptyTokens,
  normalizeModel,
  type CostBreakdown,
  type ModelPrice,
  type TokenCounts,
  ZERO_COST,
} from "./pricing.js";

/**
 * Rolling parsed events into the shapes we display and upload.
 *
 * The upload unit is one (day, tool, model) bucket — no project names, no
 * paths, no prompt text. That is the whole privacy surface of this tool, and
 * keeping the aggregation here means nothing finer-grained can leak into the
 * payload by accident.
 */

export interface Bucket {
  day: string;
  tool: string;
  model: string;
  requests: number;
  tokens: TokenCounts;
  cost: CostBreakdown;
  /** True when no rate was known, so `cost` is zero but not meaningful. */
  unpriced: boolean;
  fast: boolean;
}

export interface ModelSummary {
  model: string;
  requests: number;
  tokens: TokenCounts;
  cost: CostBreakdown;
  unpriced: boolean;
}

export interface ToolSummary {
  tool: string;
  requests: number;
  tokens: TokenCounts;
  cost: CostBreakdown;
  models: number;
  unpriced: boolean;
}

export interface Totals {
  requests: number;
  tokens: TokenCounts;
  cost: CostBreakdown;
}

export interface Aggregation {
  buckets: Bucket[];
  byModel: ModelSummary[];
  byTool: ToolSummary[];
  byDay: { day: string; requests: number; cost: CostBreakdown; tokens: TokenCounts }[];
  totals: Totals;
  /** Models we had no pricing for — surfaced rather than silently zeroed. */
  unknownModels: string[];
  firstDay: string | null;
  lastDay: string | null;
}

export function aggregate(
  events: UsageEvent[],
  pricing?: Record<string, ModelPrice>,
): Aggregation {
  // Fast and standard requests price differently, so they cannot share a bucket.
  const buckets = new Map<string, Bucket>();
  const unknownModels = new Set<string>();

  for (const event of events) {
    const model = normalizeModel(event.model);
    const fast = event.fast === true;
    const key = `${event.day} ${event.tool} ${model} ${fast ? "fast" : "std"}`;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        day: event.day,
        tool: event.tool,
        model,
        requests: 0,
        tokens: emptyTokens(),
        cost: { ...ZERO_COST },
        unpriced: false,
        fast,
      };
      buckets.set(key, bucket);
    }

    bucket.requests++;
    addTokens(bucket.tokens, event.tokens);

    const cost = computeCost(model, event.tokens, { fast, pricing });
    if (cost) {
      bucket.cost = addCost(bucket.cost, cost);
    } else if (typeof event.reportedCostUsd === "number" && event.reportedCostUsd > 0) {
      // No catalog rate, but the tool computed a cost itself — better than
      // dropping the spend entirely.
      bucket.cost = addCost(bucket.cost, {
        ...ZERO_COST,
        total: event.reportedCostUsd,
      });
    } else {
      bucket.unpriced = true;
      unknownModels.add(`${event.tool}:${model}`);
    }
  }

  const list = [...buckets.values()].sort(
    (a, b) =>
      a.day.localeCompare(b.day) || a.tool.localeCompare(b.tool) || a.model.localeCompare(b.model),
  );

  return {
    buckets: list,
    byModel: summarizeByModel(list),
    byTool: summarizeByTool(list),
    byDay: summarizeByDay(list),
    totals: sumTotals(list),
    unknownModels: [...unknownModels].sort(),
    firstDay: list.length > 0 ? (list[0]?.day ?? null) : null,
    lastDay: list.length > 0 ? (list[list.length - 1]?.day ?? null) : null,
  };
}

function summarizeByModel(buckets: Bucket[]): ModelSummary[] {
  const map = new Map<string, ModelSummary>();

  for (const bucket of buckets) {
    // Claude Code writes `claude-opus-5-5`, Copilot `claude-opus-5.5`: one
    // model, so one line. Same rule as the website's `canonicalModelId`.
    // Sync rows keep the original id; the server's row ids are built from it.
    const model = bucket.model.startsWith("claude-") ? bucket.model.replace(/\./g, "-") : bucket.model;
    let entry = map.get(model);
    if (!entry) {
      entry = {
        model,
        requests: 0,
        tokens: emptyTokens(),
        cost: { ...ZERO_COST },
        unpriced: false,
      };
      map.set(model, entry);
    }
    entry.requests += bucket.requests;
    addTokens(entry.tokens, bucket.tokens);
    entry.cost = addCost(entry.cost, bucket.cost);
    entry.unpriced ||= bucket.unpriced;
  }

  // Most expensive first — that is the number people are looking for.
  return [...map.values()].sort((a, b) => b.cost.total - a.cost.total);
}

function summarizeByTool(buckets: Bucket[]): ToolSummary[] {
  const map = new Map<string, ToolSummary & { modelSet: Set<string> }>();

  for (const bucket of buckets) {
    let entry = map.get(bucket.tool);
    if (!entry) {
      entry = {
        tool: bucket.tool,
        requests: 0,
        tokens: emptyTokens(),
        cost: { ...ZERO_COST },
        models: 0,
        unpriced: false,
        modelSet: new Set<string>(),
      };
      map.set(bucket.tool, entry);
    }
    entry.requests += bucket.requests;
    addTokens(entry.tokens, bucket.tokens);
    entry.cost = addCost(entry.cost, bucket.cost);
    entry.unpriced ||= bucket.unpriced;
    entry.modelSet.add(bucket.model);
  }

  return [...map.values()]
    .map(({ modelSet, ...rest }) => ({ ...rest, models: modelSet.size }))
    .sort((a, b) => b.cost.total - a.cost.total);
}

function summarizeByDay(buckets: Bucket[]) {
  const map = new Map<
    string,
    { day: string; requests: number; cost: CostBreakdown; tokens: TokenCounts }
  >();

  for (const bucket of buckets) {
    let entry = map.get(bucket.day);
    if (!entry) {
      entry = { day: bucket.day, requests: 0, cost: { ...ZERO_COST }, tokens: emptyTokens() };
      map.set(bucket.day, entry);
    }
    entry.requests += bucket.requests;
    entry.cost = addCost(entry.cost, bucket.cost);
    addTokens(entry.tokens, bucket.tokens);
  }

  return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
}

function sumTotals(buckets: Bucket[]): Totals {
  const totals: Totals = { requests: 0, tokens: emptyTokens(), cost: { ...ZERO_COST } };
  for (const bucket of buckets) {
    totals.requests += bucket.requests;
    addTokens(totals.tokens, bucket.tokens);
    totals.cost = addCost(totals.cost, bucket.cost);
  }
  return totals;
}

/** One uploaded row. Deliberately free of anything identifying a project. */
export interface SyncRow {
  day: string;
  tool: string;
  model: string;
  requests: number;
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  costUsd: number;
  fast: boolean;
}

export function toSyncRows(aggregation: Aggregation): SyncRow[] {
  return aggregation.buckets
    .filter((bucket) => bucket.day !== "unknown")
    .map((bucket) => ({
      day: bucket.day,
      tool: bucket.tool,
      model: bucket.model,
      requests: bucket.requests,
      input: bucket.tokens.input,
      output: bucket.tokens.output,
      cacheWrite5m: bucket.tokens.cacheWrite5m,
      cacheWrite1h: bucket.tokens.cacheWrite1h,
      cacheRead: bucket.tokens.cacheRead,
      costUsd: Number(bucket.cost.total.toFixed(6)),
      fast: bucket.fast,
    }));
}
