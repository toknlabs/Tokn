/**
 * Profile appearance preferences.
 *
 * Stored as a JSON blob on the profile row. Everything here is presentation:
 * which accent a visitor sees, how the avatar is drawn, which blocks appear
 * and in what order, and which four figures lead the page. None of it changes
 * what is measured or how anyone ranks.
 *
 * Parsing is total — a malformed or half-written blob falls back to the
 * defaults rather than breaking a profile. Unknown keys are dropped on read,
 * so an old blob written by a newer build degrades instead of erroring.
 */

/* ---------------------------------------------------------------- accents */

/**
 * Named accents rather than a free colour picker.
 *
 * A raw hex value cannot satisfy both themes: what reads well on near-black is
 * usually invisible on white. Each name therefore carries a pair, and the CSS
 * picks between them. It also keeps every profile inside a palette that still
 * looks like this site.
 */
export const ACCENTS = [
  "lime",
  "amber",
  "orange",
  "coral",
  "rose",
  "violet",
  "blue",
  "cyan",
  "teal",
  "mint",
  "mono",
] as const;

export type Accent = (typeof ACCENTS)[number];

export const DEFAULT_ACCENT: Accent = "lime";

/* ---------------------------------------------------------------- avatars */

export const AVATAR_STYLES = ["auto", "initial", "github"] as const;
export type AvatarStyle = (typeof AVATAR_STYLES)[number];

/* ----------------------------------------------------------------- blocks */

export const BLOCKS = [
  "activity",
  "spend",
  "tokens",
  "models",
  "tools",
  "plans",
  "summary",
] as const;
export type BlockKey = (typeof BLOCKS)[number];

export const BLOCK_LABELS: Record<BlockKey, string> = {
  activity: "activity grid",
  spend: "spend over time",
  tokens: "token mix",
  models: "models",
  tools: "tools",
  plans: "what you pay for",
  summary: "summary table",
};

/* ------------------------------------------------------------------ stats */

export const STATS = [
  "spend",
  "tokens",
  "requests",
  "activeDays",
  "streak",
  "longestStreak",
  "models",
  "tools",
  "perDay",
  "perRequest",
  "biggestDay",
  "planRoi",
] as const;

export type StatKey = (typeof STATS)[number];

export const STAT_LABELS: Record<StatKey, string> = {
  spend: "spend",
  tokens: "tokens",
  requests: "requests",
  activeDays: "active days",
  streak: "current streak",
  longestStreak: "longest streak",
  models: "models",
  tools: "tools",
  perDay: "per active day",
  perRequest: "per request",
  biggestDay: "biggest day",
  planRoi: "plan return",
};

/** The headline row is four wide; more would wrap and stop being a headline. */
export const STAT_SLOTS = 4;

/* ------------------------------------------------------------------ shape */

export interface ProfilePrefs {
  accent: Accent;
  avatar: AvatarStyle;
  /** Visible blocks, in render order. An empty list hides every block. */
  blocks: BlockKey[];
  /** Exactly `STAT_SLOTS` keys once normalised. */
  stats: StatKey[];
}

export const DEFAULT_PREFS: ProfilePrefs = {
  accent: DEFAULT_ACCENT,
  avatar: "auto",
  blocks: ["activity", "spend", "tokens", "models", "plans", "summary"],
  stats: ["spend", "tokens", "longestStreak", "streak"],
};

/* ------------------------------------------------------------- read/write */

function oneOf<T extends string>(
  options: readonly T[],
  value: unknown,
  fallback: T,
): T {
  return typeof value === "string" &&
    (options as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/** Keep the caller's order, drop anything unknown, and never repeat a key. */
function subset<T extends string>(
  options: readonly T[],
  value: unknown,
): T[] | null {
  if (!Array.isArray(value)) return null;

  const seen = new Set<T>();
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    if (!(options as readonly string[]).includes(entry)) continue;
    seen.add(entry as T);
  }

  return [...seen];
}

export function parsePrefs(stored: string | null | undefined): ProfilePrefs {
  if (!stored) return DEFAULT_PREFS;

  let raw: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) return DEFAULT_PREFS;
    raw = parsed as Record<string, unknown>;
  } catch {
    return DEFAULT_PREFS;
  }

  const blocks = subset(BLOCKS, raw.blocks);
  const stats = subset(STATS, raw.stats);

  return {
    accent: oneOf(ACCENTS, raw.accent, DEFAULT_PREFS.accent),
    avatar: oneOf(AVATAR_STYLES, raw.avatar, DEFAULT_PREFS.avatar),
    // An empty array is a real choice ("hide everything"); only a missing or
    // malformed value falls back.
    blocks: blocks ?? DEFAULT_PREFS.blocks,
    stats: padStats(stats ?? DEFAULT_PREFS.stats),
  };
}

/**
 * The headline row always renders four cells, so a short selection is topped
 * up from the defaults rather than leaving holes in the layout.
 */
function padStats(chosen: StatKey[]): StatKey[] {
  const out = chosen.slice(0, STAT_SLOTS);
  for (const key of DEFAULT_PREFS.stats) {
    if (out.length >= STAT_SLOTS) break;
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

/** Serialise for storage, or null when the user is on every default. */
export function serializePrefs(prefs: ProfilePrefs): string | null {
  const isDefault =
    prefs.accent === DEFAULT_PREFS.accent &&
    prefs.avatar === DEFAULT_PREFS.avatar &&
    sameList(prefs.blocks, DEFAULT_PREFS.blocks) &&
    sameList(prefs.stats, DEFAULT_PREFS.stats);

  return isDefault ? null : JSON.stringify(prefs);
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Turn a block on without disturbing the rest of the layout.
 *
 * Used when someone saves their first plan: an existing preferences blob has
 * no opinion about a block that did not exist when it was written, and the
 * alternative is a section they filled in that silently never appears.
 */
export function withBlock(prefs: ProfilePrefs, key: BlockKey): ProfilePrefs {
  if (prefs.blocks.includes(key)) return prefs;
  return { ...prefs, blocks: [...prefs.blocks, key] };
}

/** Build a preferences object from submitted form fields. */
export function prefsFromForm(form: {
  accent: unknown;
  avatar: unknown;
  blocks: unknown[];
  stats: unknown[];
}): ProfilePrefs {
  return {
    accent: oneOf(ACCENTS, form.accent, DEFAULT_PREFS.accent),
    avatar: oneOf(AVATAR_STYLES, form.avatar, DEFAULT_PREFS.avatar),
    blocks: subset(BLOCKS, form.blocks) ?? [],
    stats: padStats(subset(STATS, form.stats) ?? []),
  };
}
