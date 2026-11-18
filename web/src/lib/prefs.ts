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
  "figures",
  "activity",
  "lately",
  "standing",
  "spend",
  "tokens",
  "models",
  "tools",
  "records",
  "rhythm",
  "plans",
  "summary",
  "costs",
] as const;
export type BlockKey = (typeof BLOCKS)[number];

export const BLOCK_LABELS: Record<BlockKey, string> = {
  figures: "headline figures",
  activity: "activity grid",
  lately: "last 7 and 30 days",
  standing: "rank",
  spend: "spend per day",
  tokens: "token mix",
  models: "models",
  tools: "tools",
  records: "records",
  rhythm: "by weekday",
  plans: "what you pay for",
  summary: "summary table",
  costs: "where the money went",
};

/**
 * Sections taken off profiles at the owner's request on 2026-11-17: spend per
 * day, token mix, where the money went, and the 7 and 30 day figures.
 *
 * They stay in BLOCKS so a saved layout that names them still parses and
 * `seen` still records them, which keeps them from coming back as "new" if
 * they return. Parsing drops them, so the profile, its customise mode and the
 * settings form never draw, offer or reorder a section that cannot appear. A
 * move that swapped with one of them would look like a button that does
 * nothing.
 */
export const REMOVED_BLOCKS: ReadonlySet<BlockKey> = new Set<BlockKey>([
  "spend",
  "tokens",
  "costs",
  "lately",
]);

/** Every section an owner can turn on, in default order. */
export const OFFERED_BLOCKS: readonly BlockKey[] = BLOCKS.filter(
  (key) => !REMOVED_BLOCKS.has(key),
);

const offered = (keys: readonly BlockKey[]): BlockKey[] =>
  keys.filter((key) => !REMOVED_BLOCKS.has(key));

/* ------------------------------------------------------------------ looks */

/**
 * How each section is drawn. The first look in each list is the default.
 *
 * A look changes presentation only: the same figures, read a different way.
 * `glyph` names the little picture the settings page shows beside each choice,
 * so someone picks a shape rather than decoding a word.
 */
export const LOOKS = {
  figures: [
    { key: "large", label: "large", glyph: "headline" },
    { key: "small", label: "small", glyph: "cells" },
  ],
  activity: [
    { key: "squares", label: "squares", glyph: "squares" },
    { key: "months", label: "by month", glyph: "columns" },
    { key: "numbers", label: "numbers", glyph: "cells" },
  ],
  lately: [
    { key: "cells", label: "cells", glyph: "cells" },
    { key: "list", label: "list", glyph: "list" },
    { key: "headline", label: "headline", glyph: "headline" },
  ],
  standing: [
    { key: "cells", label: "cells", glyph: "cells" },
    { key: "list", label: "list", glyph: "list" },
    { key: "tags", label: "tags", glyph: "tags" },
  ],
  spend: [
    { key: "bars", label: "bars", glyph: "columns" },
    { key: "line", label: "line", glyph: "line" },
    { key: "compact", label: "compact", glyph: "compact" },
  ],
  tokens: [
    { key: "stacked", label: "stacked", glyph: "columns" },
    { key: "split", label: "split bar", glyph: "split" },
    { key: "table", label: "table", glyph: "table" },
  ],
  models: [
    { key: "bars", label: "bars", glyph: "hbars" },
    { key: "table", label: "table", glyph: "table" },
    { key: "ring", label: "ring", glyph: "ring" },
  ],
  tools: [
    { key: "bars", label: "bars", glyph: "hbars" },
    { key: "table", label: "table", glyph: "table" },
    { key: "ring", label: "ring", glyph: "ring" },
  ],
  records: [
    { key: "cells", label: "cells", glyph: "cells" },
    { key: "list", label: "list", glyph: "list" },
  ],
  rhythm: [
    { key: "columns", label: "columns", glyph: "columns" },
    { key: "bars", label: "bars", glyph: "hbars" },
  ],
  plans: [{ key: "list", label: "list", glyph: "list" }],
  summary: [
    { key: "grid", label: "grid", glyph: "grid" },
    { key: "list", label: "list", glyph: "list" },
    { key: "cells", label: "cells", glyph: "cells" },
  ],
  costs: [
    { key: "full", label: "full", glyph: "full" },
    { key: "compact", label: "compact", glyph: "compact" },
  ],
} as const satisfies Record<
  BlockKey,
  readonly { key: string; label: string; glyph: string }[]
>;

export type LookKey<B extends BlockKey> = (typeof LOOKS)[B][number]["key"];
export type Glyph = (typeof LOOKS)[BlockKey][number]["glyph"];

/** The look a block is drawn with: the owner's choice, or its default. */
export function lookOf<B extends BlockKey>(
  prefs: ProfilePrefs,
  block: B,
): LookKey<B> {
  const chosen = prefs.looks[block];
  const options = LOOKS[block] as readonly { key: string }[];
  return (options.some((o) => o.key === chosen) ? chosen : options[0]!.key) as LookKey<B>;
}

/** Keep only real, non-default looks, so an untouched section stores nothing. */
function cleanLooks(value: unknown): Partial<Record<BlockKey, string>> {
  if (typeof value !== "object" || value === null) return {};
  const out: Partial<Record<BlockKey, string>> = {};
  for (const block of BLOCKS) {
    const chosen = (value as Record<string, unknown>)[block];
    const options = LOOKS[block] as readonly { key: string }[];
    if (typeof chosen !== "string" || chosen === options[0]!.key) continue;
    if (options.some((o) => o.key === chosen)) out[block] = chosen;
  }
  return out;
}

/**
 * Every block that existed before saved preferences began recording which
 * blocks their owner had been offered.
 *
 * A blob without `seen` was written when this was the whole list, so any
 * block outside it is one its owner never had the chance to turn off.
 */
const LEGACY_BLOCKS: readonly BlockKey[] = [
  "activity",
  "spend",
  "tokens",
  "models",
  "tools",
  "plans",
  "summary",
];

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
  /** Non-default looks only; see `lookOf`. */
  looks: Partial<Record<BlockKey, string>>;
  /**
   * Blocks drawn at half width, so two can sit side by side. Every block is
   * full width on a phone regardless.
   */
  half: BlockKey[];
}

export const DEFAULT_PREFS: ProfilePrefs = {
  accent: DEFAULT_ACCENT,
  avatar: "auto",
  blocks: offered([
    "figures",
    "lately",
    "standing",
    "activity",
    "spend",
    "tokens",
    "models",
    "tools",
    "records",
    "rhythm",
    "costs",
    "plans",
    "summary",
  ]),
  stats: ["spend", "tokens", "longestStreak", "streak"],
  looks: {},
  half: offered(["lately", "standing", "models", "tools", "records", "rhythm"]),
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
    blocks: blocks
      ? offered(withUnseen(blocks, subset(BLOCKS, raw.seen) ?? LEGACY_BLOCKS))
      : DEFAULT_PREFS.blocks,
    stats: padStats(stats ?? DEFAULT_PREFS.stats),
    looks: cleanLooks(raw.looks),
    // A blob from before widths existed gets the default pairing.
    half: offered(subset(BLOCKS, raw.half) ?? DEFAULT_PREFS.half),
  };
}

/**
 * Add the default blocks a saved layout predates.
 *
 * Without this, every block added after someone saved their preferences
 * would be missing from their profile until they found it in settings. Each
 * goes in after the nearest block that comes before it in the default order,
 * so a new block lands where it would on a fresh profile.
 *
 * An empty list stays empty: "hide everything" includes what comes later.
 */
function withUnseen(
  chosen: BlockKey[],
  seen: readonly BlockKey[],
): BlockKey[] {
  if (chosen.length === 0) return chosen;

  const out = [...chosen];
  DEFAULT_PREFS.blocks.forEach((key, index) => {
    if (seen.includes(key) || out.includes(key)) return;
    const before = DEFAULT_PREFS.blocks
      .slice(0, index)
      .reverse()
      .find((earlier) => out.includes(earlier));
    out.splice(before ? out.indexOf(before) + 1 : 0, 0, key);
  });
  return out;
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
    sameList(prefs.stats, DEFAULT_PREFS.stats) &&
    Object.keys(cleanLooks(prefs.looks)).length === 0 &&
    sameList(prefs.half, DEFAULT_PREFS.half);

  // `seen` records which blocks were on offer, so a block added later can tell
  // "turned off" apart from "did not exist yet".
  return isDefault
    ? null
    : JSON.stringify({ ...prefs, looks: cleanLooks(prefs.looks), seen: BLOCKS });
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

export type LayoutEdit = "hide" | "show" | "up" | "down" | "width";

/**
 * One change to the layout, made from the profile itself rather than the
 * settings form. Moves are within the visible list; showing a section puts it
 * back at the end, where its owner can see it arrived.
 */
export function editLayout(
  prefs: ProfilePrefs,
  edit: LayoutEdit,
  block: BlockKey,
): ProfilePrefs {
  const blocks = [...prefs.blocks];
  const index = blocks.indexOf(block);

  switch (edit) {
    case "hide":
      return { ...prefs, blocks: blocks.filter((key) => key !== block) };
    case "show":
      return index >= 0 ? prefs : { ...prefs, blocks: [...blocks, block] };
    case "up":
    case "down": {
      const target = index + (edit === "up" ? -1 : 1);
      if (index < 0 || target < 0 || target >= blocks.length) return prefs;
      [blocks[index], blocks[target]] = [blocks[target]!, blocks[index]!];
      return { ...prefs, blocks };
    }
    case "width":
      return {
        ...prefs,
        half: prefs.half.includes(block)
          ? prefs.half.filter((key) => key !== block)
          : [...prefs.half, block],
      };
  }
}

export function isLayoutEdit(value: unknown): value is LayoutEdit {
  return value === "hide" || value === "show" || value === "up" || value === "down" || value === "width";
}

export function isBlock(value: unknown): value is BlockKey {
  return typeof value === "string" && (BLOCKS as readonly string[]).includes(value);
}

/** Build a preferences object from submitted form fields. */
export function prefsFromForm(form: {
  accent: unknown;
  avatar: unknown;
  blocks: unknown[];
  stats: unknown[];
  looks: Record<string, unknown>;
  half: unknown[];
}): ProfilePrefs {
  return {
    accent: oneOf(ACCENTS, form.accent, DEFAULT_PREFS.accent),
    avatar: oneOf(AVATAR_STYLES, form.avatar, DEFAULT_PREFS.avatar),
    blocks: subset(BLOCKS, form.blocks) ?? [],
    stats: padStats(subset(STATS, form.stats) ?? []),
    looks: cleanLooks(form.looks),
    half: subset(BLOCKS, form.half) ?? [],
  };
}
