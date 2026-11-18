/**
 * Demo accounts.
 *
 *   npm run seed:demo          add them
 *   npm run seed:demo -- --remove   take them all away again
 *
 * Every account written here carries `seeded: true`, which is the only reason
 * that column exists: once real people sign up, demo rows must stay findable.
 * Nothing reads the flag at runtime, so it costs nothing to carry.
 *
 * Two things make a seeded board look fake, and both are avoided here:
 *
 *   - **One generator for everybody.** A board where every handle is
 *     adjective+noun and every account has the same shape reads as a template
 *     at a glance. Accounts here come from archetypes — a few people who live
 *     in an agent all day, a long tail who open one a couple of times a week,
 *     contractors who appear for three weeks and vanish — and the handles are
 *     written out rather than assembled.
 *   - **Costs that do not follow from the tokens.** The site shows cost
 *     anatomy, blended rates and what-if pricing, all derived from the same
 *     rows. If `costUsd` were a random number the panels would contradict each
 *     other. Cost here is computed from the rate card, the way the CLI does
 *     it, so every derived view stays consistent.
 *
 * Deliberately not set: profile links. A demo account pointing at a real
 * github.com or x.com profile would attach a stranger's identity to invented
 * usage. Display names are handles or informal, never full names, for the same
 * reason.
 */

import { db, DB_ID, Query } from "./client.ts";
import { hashPassword } from "./crypto.ts";
import crypto from "node:crypto";
import { newId, usageRowId, totalsRowId, hashToken } from "./ids.ts";
import { refreshTotals } from "./repo/leaderboard.ts";

/* ------------------------------------------------------------------ rates */

/**
 * Rates come from the `pricing` collection, not a table copied in here.
 *
 * The site prices what-if comparisons from that collection. If the seeder
 * carried its own numbers the two would drift, and a profile would show a
 * model costing one thing in its own row and another in the comparison beside
 * it. One source, so they cannot disagree.
 */

interface Rate {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWrite1h: number;
}

const PER_MILLION = 1_000_000;

async function loadRates(models: readonly string[]): Promise<Map<string, Rate>> {
  const rates = new Map<string, Rate>();

  for (const model of models) {
    const found = await db().listDocuments(DB_ID, "pricing", [
      Query.equal("modelId", model),
      Query.limit(1),
    ]);
    const doc = (found.documents as unknown as Record<string, number | undefined>[])[0];
    if (!doc) throw new Error(`no published rate for ${model} — seed:pricing first`);

    const input = doc.input ?? 0;
    rates.set(model, {
      input,
      output: doc.output ?? 0,
      // A provider that publishes no cache tier still has cache traffic priced
      // somehow; the Anthropic ratios are the closest published convention.
      // A published zero is honoured — some providers really do not charge.
      cacheRead: doc.cacheRead ?? input * 0.1,
      cacheWrite: doc.cacheWrite ?? input * 1.25,
      cacheWrite1h: doc.cacheWrite1h ?? input * 2,
    });
  }

  return rates;
}

interface Bucket {
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
}

/** The CLI's own sum, so the site's derived panels agree with the rows. */
function priceOf(rate: Rate, b: Bucket): number {
  const usd =
    (b.input * rate.input +
      b.output * rate.output +
      b.cacheWrite5m * rate.cacheWrite +
      b.cacheWrite1h * rate.cacheWrite1h +
      b.cacheRead * rate.cacheRead) /
    PER_MILLION;
  return Math.round(usd * 10000) / 10000;
}

/* ----------------------------------------------------------------- random */

/** Seeded PRNG, so re-running produces the same board rather than a new one. */
function rng(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

const pick = <T>(r: () => number, list: readonly T[]): T =>
  list[Math.floor(r() * list.length)]!;

const between = (r: () => number, lo: number, hi: number): number =>
  lo + r() * (hi - lo);

const intBetween = (r: () => number, lo: number, hi: number): number =>
  Math.floor(between(r, lo, hi + 1));

/** Two uniforms averaged: clusters toward the middle, unlike a flat pick. */
const humped = (r: () => number, lo: number, hi: number): number =>
  lo + ((r() + r()) / 2) * (hi - lo);

/* --------------------------------------------------------------- the cast */

type Shape =
  | "titan" // runs agents in parallel, effectively a small team of one
  | "whale" // lives in an agent, all day, every day
  | "steady" // consistent weekday use
  | "weekend" // side project, Saturdays
  | "burst" // contract work in blocks, then nothing
  | "ramp" // found it recently and is ramping up
  | "taper" // was heavy, drifting away
  | "light" // occasional, cheap models
  | "new" // joined in the last fortnight
  | "lurker"; // signed up, never synced

interface Person {
  handle: string;
  shape: Shape;
  name?: string;
  bio?: string;
}

/**
 * Written out rather than generated. Handles that share a formula are the
 * single clearest tell that a board is fabricated, so these vary in shape the
 * way real ones do: some words, some compounds, some with digits, some with
 * separators, some plainly jokes.
 */
const PEOPLE: Person[] = [
  { handle: "ci_goblin", shape: "titan", bio: "i let it run overnight. twice." },
  { handle: "offbyonce", shape: "titan", bio: "agents all day, regrets some of them" },
  { handle: "tarpit", shape: "titan", name: "tar", bio: "distributed systems, mostly Go" },
  { handle: "rm_rf_prod", shape: "titan", bio: "i have learned nothing" },
  { handle: "coldstart", shape: "whale", name: "cs" },
  { handle: "bisect", shape: "whale", bio: "compilers. ask me about parsers, do not ask me about dates" },
  { handle: "quietloop", shape: "steady", bio: "backend, boring on purpose" },
  { handle: "nulljoin", shape: "steady", name: "nj" },
  { handle: "semicolon.optional", shape: "steady", bio: "typescript, reluctantly" },
  { handle: "padright", shape: "steady" },
  { handle: "k8s_pilot", shape: "steady", bio: "yaml archaeologist" },
  { handle: "worksonmybox", shape: "steady", bio: "it does though" },
  { handle: "twospaces", shape: "steady", name: "two" },
  { handle: "dryrun", shape: "whale", bio: "infra, on call more than i would like" },
  { handle: "mainthread", shape: "steady" },
  { handle: "softdelete", shape: "steady", bio: "nothing is ever really gone" },
  { handle: "heapspray", shape: "whale", name: "heap", bio: "security research" },
  { handle: "void42", shape: "steady" },
  { handle: "flakytest", shape: "steady", bio: "it passes locally" },
  { handle: "grepcat", shape: "steady", name: "gc" },
  { handle: "ninetynine", shape: "steady", bio: "99% done, 99% left" },
  { handle: "stalebranch", shape: "taper", bio: "merged, eventually" },
  { handle: "yakstack", shape: "taper", name: "yak" },
  { handle: "tabnine_fan", shape: "taper" },
  { handle: "monorepoman", shape: "taper", bio: "one repo, many regrets" },
  { handle: "rubberduckd", shape: "taper", bio: "the duck is a daemon now" },
  { handle: "lgtm_ship_it", shape: "weekend", bio: "reviews are a formality on my own repos" },
  { handle: "sundaydeploy", shape: "weekend", name: "sun" },
  { handle: "hobbyscope", shape: "weekend", bio: "weekend rust, weekday java" },
  { handle: "bedroomdev", shape: "weekend" },
  { handle: "raspberryfi", shape: "weekend", bio: "home lab, three pis and a dream" },
  { handle: "ottercode", shape: "weekend", name: "otter" },
  { handle: "sidequest", shape: "weekend", bio: "the side project is the project" },
  { handle: "latenightci", shape: "weekend" },
  { handle: "contractkid", shape: "burst", bio: "available q4" },
  { handle: "sprintzero", shape: "burst", name: "sz" },
  { handle: "billable", shape: "burst", bio: "freelance backend" },
  { handle: "shipitsquirrel", shape: "burst" },
  { handle: "agency_dev", shape: "burst", bio: "four clients, four stacks" },
  { handle: "redline", shape: "burst", name: "red" },
  { handle: "newtothis", shape: "ramp", bio: "two months in, going well so far" },
  { handle: "juniorish", shape: "ramp", name: "jr" },
  { handle: "firstpr", shape: "ramp", bio: "learning go the hard way" },
  { handle: "bootcamp22", shape: "ramp" },
  { handle: "readsthedocs", shape: "ramp", bio: "actually reads them" },
  { handle: "promptsmith", shape: "ramp", name: "ps" },
  { handle: "ctrlaltdefeat", shape: "ramp", bio: "switched from copilot last month" },
  { handle: "typedholes", shape: "ramp" },
  { handle: "scriptkitty", shape: "light", bio: "python, small things" },
  { handle: "onceaweek", shape: "light" },
  { handle: "csvwrangler", shape: "light", bio: "data plumbing" },
  { handle: "sheetsguy", shape: "light", name: "sg" },
  { handle: "notadev", shape: "light", bio: "pm who writes scripts" },
  { handle: "slowlane", shape: "light" },
  { handle: "readonlymode", shape: "light", bio: "mostly reviewing" },
  { handle: "glueperson", shape: "light", bio: "i connect the things" },
  { handle: "twelvefactor", shape: "light" },
  { handle: "makefile", shape: "light", name: "mk" },
  { handle: "pagerduty_ptsd", shape: "light", bio: "sre, sleeping better now" },
  { handle: "unitcircle", shape: "light" },
  { handle: "brandnew", shape: "new", bio: "just installed this" },
  { handle: "day_one", shape: "new" },
  { handle: "hellotokn", shape: "new", name: "hi" },
  { handle: "curiousaf", shape: "new", bio: "here to see the damage" },
  { handle: "justlooking", shape: "new" },
  { handle: "firstscan", shape: "new", bio: "wow" },
  { handle: "hardreset", shape: "new", name: "hr" },
  { handle: "someonesaid", shape: "lurker" },
  { handle: "maybe_later", shape: "lurker", bio: "will set this up eventually" },
  { handle: "signedupOnly", shape: "lurker" },
];

/* ------------------------------------------------------------- generation */

const TOOL_MIX: Record<Shape, readonly string[]> = {
  titan: ["claude-code", "claude-code", "claude-code", "codex", "claude-desktop", "cursor"],
  whale: ["claude-code", "claude-code", "claude-code", "claude-desktop", "codex"],
  steady: ["claude-code", "claude-code", "claude-code", "cursor", "claude-desktop"],
  weekend: ["claude-code", "claude-code", "cursor"],
  burst: ["claude-code", "claude-code", "codex"],
  ramp: ["claude-code", "claude-code", "cursor", "copilot-cli"],
  taper: ["claude-code", "claude-code", "claude-desktop"],
  light: ["claude-code", "claude-desktop", "copilot-cli"],
  new: ["claude-code"],
  lurker: [],
};

/**
 * Weighted model preference per archetype.
 *
 * Deliberately spread across providers. Nobody runs one vendor's whole
 * catalogue and nothing else, and a board where every row says the same three
 * Claude models describes a world that does not exist. Who picks what is the
 * interesting part: the heavy accounts sit on frontier models from whoever
 * ships them, the hobbyists are on the cheap open-weight ones, and the
 * accounts drifting away are still on versions from six months ago.
 *
 * Every id here must exist in the `pricing` collection.
 */
const MODEL_MIX: Record<Shape, readonly (readonly [string, number])[]> = {
  titan: [
    ["gpt-6-astra", 0.4],
    ["claude-opus-5", 0.38],
    ["gemini-3-pro", 0.22],
  ],
  whale: [
    ["claude-opus-5", 0.5],
    ["claude-sonnet-5", 0.28],
    ["gpt-5.6-sol", 0.22],
  ],
  steady: [
    ["claude-sonnet-5", 0.45],
    ["gpt-5.6-sol", 0.25],
    ["claude-opus-5", 0.18],
    ["claude-haiku-4-5", 0.12],
  ],
  weekend: [
    ["glm-5.2", 0.38],
    ["claude-sonnet-5", 0.34],
    ["deepseek-v4-flash", 0.28],
  ],
  burst: [
    ["claude-opus-5", 0.4],
    ["gemini-3-pro", 0.35],
    ["claude-sonnet-5", 0.25],
  ],
  ramp: [
    ["claude-sonnet-5", 0.42],
    ["kimi-k3", 0.3],
    ["claude-haiku-4-5", 0.28],
  ],
  taper: [
    // Still on what was current when they stopped paying attention.
    ["claude-opus-4-8", 0.38],
    ["claude-sonnet-4-6", 0.34],
    ["gpt-5.2", 0.28],
  ],
  light: [
    ["deepseek-v4-flash", 0.34],
    ["claude-haiku-4-5", 0.28],
    ["qwen3-coder-plus", 0.22],
    ["gemini-2.5-flash", 0.16],
  ],
  new: [
    ["claude-sonnet-5", 0.45],
    ["gpt-6-astra", 0.3],
    ["glm-5.2", 0.25],
  ],
  lurker: [],
};

/** Every model the cast can reach for, so rates are fetched in one pass. */
const ALL_MODELS = [
  ...new Set(Object.values(MODEL_MIX).flatMap((mix) => mix.map(([model]) => model))),
];

/** Requests on an active day, before noise. */
const INTENSITY: Record<Shape, readonly [number, number]> = {
  titan: [190, 390],
  whale: [90, 330],
  steady: [22, 70],
  weekend: [30, 95],
  burst: [45, 130],
  ramp: [12, 55],
  taper: [15, 60],
  light: [4, 18],
  new: [10, 45],
  lurker: [0, 0],
};

const day = (offset: number): string => {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - offset);
  return d.toISOString().slice(0, 10);
};

const isWeekend = (iso: string): boolean => {
  const d = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return d === 0 || d === 6;
};

/** How long ago the account was created, in days. */
function tenureOf(shape: Shape, r: () => number): number {
  switch (shape) {
    case "titan":
      return intBetween(r, 230, 330);
    case "whale":
      return intBetween(r, 150, 260);
    case "steady":
      return intBetween(r, 60, 240);
    case "taper":
      return intBetween(r, 170, 300);
    case "weekend":
      return intBetween(r, 70, 220);
    case "burst":
      return intBetween(r, 90, 250);
    case "ramp":
      return intBetween(r, 30, 75);
    case "light":
      return intBetween(r, 40, 200);
    case "new":
      return intBetween(r, 2, 14);
    case "lurker":
      return intBetween(r, 1, 90);
  }
}

/**
 * Whether a given day is worked, and how hard, as a 0..1 multiplier.
 *
 * This is where the shapes actually differ. A flat "80% of days at random
 * intensity" produces a heatmap with no structure, which is the other obvious
 * tell — real activity has working weeks, holidays and a direction of travel.
 */
function effortOn(
  shape: Shape,
  ago: number,
  tenure: number,
  r: () => number,
  vacations: readonly (readonly [number, number])[],
): number {
  if (ago > tenure) return 0;
  for (const [from, to] of vacations) {
    if (ago <= from && ago >= to) return 0;
  }

  const iso = day(ago);
  const weekend = isWeekend(iso);
  const life = 1 - ago / Math.max(tenure, 1); // 0 at signup, 1 today

  switch (shape) {
    case "titan":
      // Barely stops. Weekends included, and almost no idle days.
      if (weekend && r() > 0.7) return 0;
      return r() > 0.03 ? between(r, 0.85, 1.3) : 0;
    case "whale":
      if (weekend && r() > 0.45) return 0;
      return r() > 0.06 ? between(r, 0.7, 1.15) : 0;
    case "steady":
      if (weekend && r() > 0.12) return 0;
      return r() > 0.2 ? between(r, 0.6, 1.1) : 0;
    case "weekend":
      if (!weekend && r() > 0.18) return 0;
      return between(r, 0.7, 1.2);
    case "burst": {
      // Three-week engagements separated by quiet stretches.
      const block = Math.floor(ago / 21);
      if (block % 2 === 1) return 0;
      return r() > 0.25 ? between(r, 0.75, 1.15) : 0;
    }
    case "ramp":
      // Usage grows with time on the product.
      if (r() > 0.25 + life * 0.5) return 0;
      return between(r, 0.4, 0.8) + life * 0.5;
    case "taper":
      // The mirror image: busy at the start, quiet lately.
      if (r() > 0.85 - life * 0.55) return 0;
      return between(r, 0.5, 1.0) * (1.2 - life * 0.7);
    case "light":
      return r() > 0.78 ? between(r, 0.5, 1.2) : 0;
    case "new":
      return r() > 0.25 ? between(r, 0.6, 1.2) : 0;
    case "lurker":
      return 0;
  }
}

function chooseModel(r: () => number, mix: readonly (readonly [string, number])[]): string {
  let roll = r();
  for (const [model, weight] of mix) {
    roll -= weight;
    if (roll <= 0) return model;
  }
  return mix[0]![0];
}

interface Row {
  day: string;
  tool: string;
  model: string;
  fast: boolean;
  requests: number;
  input: number;
  output: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  costUsd: number;
}

function usageFor(
  person: Person,
  r: () => number,
  tenure: number,
  rates: Map<string, Rate>,
): Row[] {
  const rows: Row[] = [];
  const models = MODEL_MIX[person.shape];
  const tools = TOOL_MIX[person.shape];
  if (models.length === 0) return rows;

  const [lo, hi] = INTENSITY[person.shape];
  // This person's personal baseline. Heavy users vary far more than light
  // ones do in real life, and without the wider spread the top of the board
  // reads as five copies of the same account.
  const scale =
    person.shape === "titan"
      ? humped(r, 1.1, 2.2)
      : person.shape === "whale"
        ? humped(r, 0.75, 2.6)
        : humped(r, 0.7, 1.35);

  // Context carried per request. Someone running long agent sessions against a
  // large codebase re-reads far more per turn than someone asking a model to
  // rename a variable, and that gap is most of the difference in their bills.
  const context = person.shape === "titan" ? between(r, 1.35, 2.15) : 1;

  // How this person works, expressed as cache reuse. Someone who keeps one
  // long session open re-reads an enormous context all day; someone who opens
  // a fresh window per task pays to rebuild it. That is a real and wide
  // behavioural spread, and the site benchmarks it by percentile — with one
  // range for everybody the whole cohort lands on the median and the panel
  // says nothing.
  const reuse = between(r, 0.3, 2.4);

  // One or two holidays for anyone who has been around long enough.
  const vacations: [number, number][] = [];
  if (tenure > 120) {
    const start = intBetween(r, 30, tenure - 20);
    vacations.push([start, Math.max(start - intBetween(r, 5, 16), 1)]);
  }
  if (tenure > 200 && r() > 0.5) {
    const start = intBetween(r, 30, tenure - 20);
    vacations.push([start, Math.max(start - intBetween(r, 4, 10), 1)]);
  }

  const primaryTool = tools[0]!;

  for (let ago = tenure; ago >= 0; ago--) {
    const effort = effortOn(person.shape, ago, tenure, r, vacations);
    if (effort <= 0) continue;

    const iso = day(ago);
    // One to three model buckets on a working day, which is what a real day
    // looks like: a cheap model for the small stuff, a big one for the rest.
    const buckets = r() > 0.55 ? (r() > 0.75 ? 3 : 2) : 1;
    const dayRequests = Math.max(1, Math.round(between(r, lo, hi) * scale * effort));

    const splits: number[] = [];
    let left = dayRequests;
    for (let i = 0; i < buckets; i++) {
      const take = i === buckets - 1 ? left : Math.round(left * between(r, 0.35, 0.75));
      splits.push(Math.max(1, take));
      left = Math.max(1, left - take);
    }

    const seen = new Set<string>();
    for (const requests of splits) {
      const model = chooseModel(r, models);
      // A tool other than the primary shows up occasionally, not per row.
      const tool = r() > 0.88 ? pick(r, tools) : primaryTool;
      const key = `${model}|${tool}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Per-request shapes taken from what an agent session actually looks
      // like: the completion is a rounding error next to the context being
      // re-read on every turn.
      const input = Math.round(requests * between(r, 600, 2100) * context);
      const output = Math.round(requests * between(r, 280, 1200));
      const writes = Math.round(requests * between(r, 1400, 5200));
      const longCache = r() > 0.5;
      const cacheWrite5m = longCache ? Math.round(writes * 0.25) : writes;
      const cacheWrite1h = longCache ? writes - Math.round(writes * 0.25) : 0;
      const cacheRead = Math.round(requests * between(r, 18_000, 110_000) * reuse * context);

      const bucket = { input, output, cacheWrite5m, cacheWrite1h, cacheRead };
      rows.push({
        day: iso,
        tool,
        model,
        fast: false,
        requests,
        ...bucket,
        costUsd: priceOf(rates.get(model)!, bucket),
      });
    }
  }

  return rows;
}

/* ------------------------------------------------------------- appearance */

const ACCENTS = ["lime", "amber", "orange", "coral", "rose", "violet", "blue", "cyan", "teal", "mint", "mono"];
const AVATARS = ["auto", "initial"];

const ALL_BLOCKS = ["activity", "spend", "tokens", "models", "tools", "plans", "summary"];
const ALL_STATS = [
  "spend", "tokens", "requests", "activeDays", "streak",
  "longestStreak", "models", "tools", "perDay", "perRequest", "biggestDay",
];

/** Fisher-Yates on a copy, so a shuffle does not disturb the source list. */
function shuffled<T>(r: () => number, list: readonly T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

function prefsFor(r: () => number, hasPlans: boolean): string | null {
  // Plenty of people never open the appearance settings at all, and a board
  // where everybody has customised their page is its own kind of tell.
  if (r() > 0.55) return null;

  // Most who do touch it change the accent and leave the layout alone; a few
  // reorder the page or pick different headline figures.
  const rearranged = r() > 0.6;
  const blocks = rearranged
    ? shuffled(r, ALL_BLOCKS).slice(0, intBetween(r, 4, 7))
    : ALL_BLOCKS.filter((b) => b !== "tools" && (hasPlans || b !== "plans"));

  const stats = r() > 0.55
    ? shuffled(r, ALL_STATS).slice(0, 4)
    : ["spend", "tokens", "longestStreak", "streak"];

  return JSON.stringify({
    accent: pick(r, ACCENTS),
    avatar: pick(r, AVATARS),
    blocks: hasPlans && !blocks.includes("plans") ? [...blocks, "plans"] : blocks,
    stats,
  });
}

const PLAN_SETS: readonly (readonly { provider: string; plan: string; kind: string; monthlyUsd?: number }[])[] = [
  [{ provider: "anthropic", plan: "Max 20x", kind: "subscription", monthlyUsd: 200 }],
  [{ provider: "anthropic", plan: "Max 5x", kind: "subscription", monthlyUsd: 100 }],
  [{ provider: "anthropic", plan: "Pro", kind: "subscription", monthlyUsd: 20 }],
  [
    { provider: "anthropic", plan: "Max 5x", kind: "subscription", monthlyUsd: 100 },
    { provider: "openai", plan: "pay as you go", kind: "api" },
  ],
  [{ provider: "anthropic", plan: "pay as you go", kind: "api" }],
  [
    { provider: "cursor", plan: "Pro", kind: "subscription", monthlyUsd: 20 },
    { provider: "anthropic", plan: "Pro", kind: "subscription", monthlyUsd: 20 },
  ],
  [{ provider: "github", plan: "Copilot Pro", kind: "subscription", monthlyUsd: 10 }],
];

/* --------------------------------------------------------------- machines */

/**
 * The machines an account syncs from.
 *
 * A profile with usage and no linked machine is the kind of inconsistency that
 * only shows up when someone looks closely, which is exactly when it matters.
 * Hostnames are the ordinary ones people actually leave set.
 */
const HOSTNAMES = [
  "macbook-pro", "mbp-14", "mbp-16", "air-m2", "mac-studio", "devbox",
  "thinkpad-x1", "workstation", "dev-vm", "home-desktop", "framework-13",
  "linux-box", "tower", "nuc", "wsl-ubuntu",
] as const;

const PLATFORMS = ["darwin-arm64", "darwin-arm64", "darwin-x64", "linux-x64", "win32-x64"] as const;

// Not everyone upgrades the day a release lands.
const CLI_VERSIONS = ["0.4.0", "0.4.0", "0.4.0", "0.3.9", "0.3.7", "0.4.1"] as const;

interface DeviceRow {
  hostname: string;
  platform: string;
  cliVersion: string;
  linkedAt: string;
  lastSyncAt: string | null;
  revokedAt: string | null;
}

function devicesFor(
  shape: Shape,
  tenure: number,
  lastActiveAgo: number | null,
  r: () => number,
): DeviceRow[] {
  if (lastActiveAgo === null) return [];

  // Heavy users work from more than one machine; light users rarely do.
  const count =
    shape === "whale" ? intBetween(r, 2, 3) : shape === "steady" || shape === "burst" ? intBetween(r, 1, 2) : 1;

  const rows: DeviceRow[] = [];
  const used = new Set<string>();

  for (let i = 0; i < count; i++) {
    let hostname = pick(r, HOSTNAMES);
    while (used.has(hostname)) hostname = pick(r, HOSTNAMES);
    used.add(hostname);

    // The first machine is linked at signup; later ones somewhere after.
    const linkedAgo = i === 0 ? tenure : intBetween(r, lastActiveAgo, Math.max(tenure - 1, lastActiveAgo));
    const linked = new Date();
    linked.setUTCHours(intBetween(r, 9, 21), intBetween(r, 0, 59), 0, 0);
    linked.setUTCDate(linked.getUTCDate() - linkedAgo);

    // A machine someone stopped using, replaced, or handed back.
    const revoked = count > 1 && i > 0 && r() > 0.82;

    const syncAgo = revoked ? intBetween(r, lastActiveAgo + 10, Math.max(linkedAgo - 1, lastActiveAgo + 11)) : lastActiveAgo;
    const synced = new Date();
    synced.setUTCHours(intBetween(r, 9, 22), intBetween(r, 0, 59), 0, 0);
    synced.setUTCDate(synced.getUTCDate() - syncAgo);

    const revokedAt = revoked ? new Date(synced.getTime() + 86_400_000 * intBetween(r, 1, 6)) : null;

    rows.push({
      hostname,
      platform: pick(r, PLATFORMS),
      cliVersion: pick(r, CLI_VERSIONS),
      linkedAt: linked.toISOString(),
      lastSyncAt: synced.toISOString(),
      revokedAt: revokedAt ? revokedAt.toISOString() : null,
    });
  }

  return rows;
}

/** Mirrors `pairId` in repo/friends.ts: one row per pair, either direction. */
function pairId(a: string, b: string): string {
  const [x, y] = a < b ? [a, b] : [b, a];
  return `f${crypto.createHash("sha256").update(`${x}|${y}`).digest("hex").slice(0, 35)}`;
}

/* ----------------------------------------------------------------- write */

const HANDLE_TO_ID = new Map<string, string>();

async function seededProfiles(): Promise<{ $id: string; handle: string }[]> {
  const found: { $id: string; handle: string }[] = [];
  let cursor: string | null = null;

  for (;;) {
    const queries = [Query.equal("seeded", true), Query.limit(100)];
    if (cursor) queries.push(Query.cursorAfter(cursor));
    const page = await db().listDocuments(DB_ID, "profiles", queries);
    const docs = page.documents as unknown as { $id: string; handle: string }[];
    found.push(...docs);
    if (docs.length < 100) break;
    cursor = docs[docs.length - 1]!.$id;
  }

  return found;
}

async function remove(): Promise<void> {
  const profiles = await seededProfiles();
  if (profiles.length === 0) {
    console.log("Nothing seeded to remove.");
    return;
  }

  console.log(`Removing ${profiles.length} seeded accounts…`);
  let rows = 0;

  for (const profile of profiles) {
    // Usage first: a profile with orphaned usage rows is worse than neither.
    // Bulk delete by query rather than row by row — these accounts carry
    // thousands of rows each, and one request per row takes minutes.
    for (;;) {
      const gone = await db().deleteDocuments(DB_ID, "usage_daily", [
        Query.equal("userId", profile.$id),
        Query.limit(500),
      ]);
      const n = gone.documents.length;
      rows += n;
      if (n === 0) break;
    }

    await db()
      .deleteDocuments(DB_ID, "devices", [Query.equal("userId", profile.$id)])
      .catch(() => {});
    await db()
      .deleteDocuments(DB_ID, "friendships", [Query.equal("userA", profile.$id)])
      .catch(() => {});
    await db()
      .deleteDocuments(DB_ID, "friendships", [Query.equal("userB", profile.$id)])
      .catch(() => {});
    await db()
      .deleteDocument(DB_ID, "user_totals", totalsRowId(profile.$id))
      .catch(() => {});
    await db().deleteDocument(DB_ID, "profiles", profile.$id);
  }

  console.log(`Removed ${profiles.length} accounts and ${rows} usage rows.`);
}

async function seed(): Promise<void> {
  const existing = await seededProfiles();
  if (existing.length > 0) {
    console.log(
      `${existing.length} seeded accounts already exist. Run with --remove first to reseed.`,
    );
    return;
  }

  const rates = await loadRates(ALL_MODELS);
  console.log(`Seeding ${PEOPLE.length} demo accounts…`);
  let totalRows = 0;
  let devices = 0;

  for (const [index, person] of PEOPLE.entries()) {
    const r = rng(0x7053 + index * 7919);
    const tenure = tenureOf(person.shape, r);
    const userId = newId("usr");
    HANDLE_TO_ID.set(person.handle, userId);

    const created = new Date();
    created.setUTCHours(intBetween(r, 8, 20), intBetween(r, 0, 59), 0, 0);
    created.setUTCDate(created.getUTCDate() - tenure);

    const rows = usageFor(person, r, tenure, rates);
    const plans = r() > 0.58 ? pick(r, PLAN_SETS) : null;
    const billing = plans
      ? plans.some((p) => p.kind === "subscription")
        ? "subscription"
        : "api"
      : r() > 0.7
        ? "subscription"
        : "api";

    // A couple of accounts are private or unlisted, because on a real board a
    // couple always are.
    const isPublic = index !== 12;
    const listed = isPublic && index !== 33;

    await db().createDocument(DB_ID, "profiles", userId, {
      handle: person.handle,
      handleLower: person.handle.toLowerCase(),
      name: person.name ?? null,
      bio: person.bio ?? null,
      // Long random secret: these accounts are not meant to be signed into.
      passwordHash: hashPassword(newId("seed") + newId("seed")),
      billing,
      links: null,
      avatarUrl: null,
      isPublic,
      listed,
      handleChanges: 0,
      plans: plans ? JSON.stringify(plans) : null,
      prefs: prefsFor(r, plans !== null),
      createdAt: created.toISOString(),
      seeded: true,
    });

    for (let i = 0; i < rows.length; i += 100) {
      const chunk = rows.slice(i, i + 100).map((row) => ({
        $id: usageRowId(userId, row.day, row.tool, row.model, row.fast),
        userId,
        updatedAt: new Date().toISOString(),
        ...row,
      }));
      await db().upsertDocuments(DB_ID, "usage_daily", chunk as never);
    }

    // Machines. A profile with usage and no linked machine does not add up.
    const lastActiveAgo =
      rows.length === 0
        ? null
        : Math.round(
            (Date.now() - new Date(`${rows[rows.length - 1]!.day}T12:00:00Z`).getTime()) / 86_400_000,
          );

    for (const device of devicesFor(person.shape, tenure, lastActiveAgo, r)) {
      await db().createDocument(DB_ID, "devices", newId("dev"), {
        userId,
        // Only ever a hash in the real flow, so only a hash here.
        tokenHash: hashToken(newId("seedtok") + newId("seedtok")),
        ...device,
      });
      devices++;
    }

    await refreshTotals(userId);
    totalRows += rows.length;

    const spend = rows.reduce((sum, row) => sum + row.costUsd, 0);
    console.log(
      `  ${String(index + 1).padStart(2)}. ${person.handle.padEnd(20)} ${person.shape.padEnd(8)} ` +
        `${String(rows.length).padStart(4)} rows  $${spend.toFixed(2)}`,
    );
  }

  // A social graph, built once every account exists. Friendship is mutual and
  // clustered rather than uniform: people who use the same tools know each
  // other, and a couple of requests are still sitting unanswered.
  const graph = rng(0x51de);
  const connectable = PEOPLE.filter((p) => p.shape !== "lurker");
  let links = 0;
  let pending = 0;
  const made = new Set<string>();

  for (const person of connectable) {
    if (graph() > 0.45) continue; // most accounts have no friends on here yet
    const friends = intBetween(graph, 1, 4);

    for (let i = 0; i < friends; i++) {
      const other = pick(graph, connectable);
      if (other.handle === person.handle) continue;

      const a = HANDLE_TO_ID.get(person.handle)!;
      const b = HANDLE_TO_ID.get(other.handle)!;
      const id = pairId(a, b);
      if (made.has(id)) continue;
      made.add(id);

      const [userA, userB] = a < b ? [a, b] : [b, a];
      const askedAgo = intBetween(graph, 3, 120);
      const asked = new Date();
      asked.setUTCDate(asked.getUTCDate() - askedAgo);
      const accepted = graph() > 0.18;
      const responded = new Date(asked.getTime() + 86_400_000 * (graph() * 3));

      await db()
        .createDocument(DB_ID, "friendships", id, {
          userA,
          userB,
          requestedBy: a,
          status: accepted ? "accepted" : "pending",
          createdAt: asked.toISOString(),
          respondedAt: accepted ? responded.toISOString() : null,
        })
        .catch(() => {});

      if (accepted) links++;
      else pending++;
    }
  }

  console.log(`\nDone.`);
  console.log(`  accounts     ${PEOPLE.length}`);
  console.log(`  usage rows   ${totalRows}`);
  console.log(`  machines     ${devices}`);
  console.log(`  friendships  ${links} accepted, ${pending} pending`);
  console.log("\nRemove them with: npm run seed:demo -- --remove");
}

if (process.argv.includes("--remove")) {
  await remove();
} else {
  await seed();
}
