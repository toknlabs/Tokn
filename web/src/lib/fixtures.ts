import "server-only";
import {
  agentRowId,
  summarize,
  usageRowId,
  type AgentDoc,
  type Profile,
  type UsageDoc,
} from "./backend";

/**
 * Placeholder data for looking at pages without a database. Development only.
 *
 * Start the dev server with `TOKN_FIXTURES=1` and the board, the profiles and
 * the Eaon pages render from a fixed cast of made-up accounts instead of
 * Appwrite. Nothing here is a real person, and nothing here is ever written
 * anywhere.
 *
 * `fixturesOn` is false whenever NODE_ENV is "production", which `next build`
 * and `next start` always set, so a deployment cannot serve these whatever
 * its environment says.
 */
export function fixturesOn(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.TOKN_FIXTURES === "1";
}

interface Person {
  handle: string;
  name: string;
  bio?: string;
  joinedDaysAgo: number;
  /** Chance of any usage on a given day. */
  activity: number;
  /** Share of a day's usage that came through Eaon Desktop. */
  eaon: number;
  /** Rough tokens on an active day. */
  scale: number;
  models: string[];
  isPublic?: boolean;
  listed?: boolean;
  prefs?: Record<string, unknown>;
  links?: string[];
  /** Days since the last activity, to give some people a broken streak. */
  idleFor?: number;
}

const CAST: Person[] = [
  {
    handle: "alex",
    name: "Alex Rivera",
    bio: "building agents that build things",
    joinedDaysAgo: 437,
    activity: 0.78,
    eaon: 0.85,
    scale: 9_000_000,
    models: ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"],
    links: ["https://github.com/octocat"],
  },
  {
    handle: "sam",
    name: "Sam Okafor",
    joinedDaysAgo: 301,
    activity: 0.66,
    eaon: 0.55,
    scale: 12_000_000,
    models: ["claude-sonnet-4-6", "gpt-5.5", "claude-opus-4-8"],
    prefs: { accent: "violet" },
  },
  {
    handle: "priya",
    name: "Priya Nair",
    joinedDaysAgo: 220,
    activity: 0.58,
    eaon: 1,
    scale: 6_500_000,
    models: ["claude-opus-4-8", "claude-sonnet-4-6"],
    prefs: { avatar: "initial" },
  },
  {
    handle: "jordan",
    name: "Jordan Lee",
    joinedDaysAgo: 180,
    activity: 0.42,
    eaon: 0.4,
    scale: 4_000_000,
    models: ["claude-sonnet-4-6", "gemini-3-pro", "claude-haiku-4-5"],
    idleFor: 6,
  },
  {
    handle: "mei",
    name: "Mei Chen",
    joinedDaysAgo: 41,
    activity: 0.8,
    eaon: 1,
    scale: 2_500_000,
    models: ["claude-sonnet-4-6"],
  },
  {
    handle: "diego",
    name: "Diego Santos",
    joinedDaysAgo: 260,
    activity: 0.6,
    eaon: 0.7,
    scale: 20_000_000,
    models: ["claude-opus-4-8"],
    isPublic: false,
  },
  {
    handle: "robin",
    name: "Robin Park",
    joinedDaysAgo: 150,
    activity: 0.5,
    eaon: 0.6,
    scale: 7_000_000,
    models: ["gpt-5.5", "claude-sonnet-4-6"],
    listed: false,
  },
  {
    handle: "taylor",
    name: "Taylor Brooks",
    joinedDaysAgo: 390,
    activity: 0.7,
    eaon: 0,
    scale: 10_000_000,
    models: ["claude-opus-4-8", "claude-sonnet-4-6"],
  },
];

/** USD per million tokens, near enough for placeholder figures. */
const RATE: Record<string, { input: number; output: number; read: number; write: number }> = {
  "claude-opus-4-8": { input: 5, output: 25, read: 0.5, write: 6.25 },
  "claude-sonnet-4-6": { input: 3, output: 15, read: 0.3, write: 3.75 },
  "claude-haiku-4-5": { input: 1, output: 5, read: 0.1, write: 1.25 },
};

/** Small seeded generator, so every reload draws the same people. */
function random(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const DAY_MS = 86_400_000;
const dayOf = (offset: number): string => new Date(Date.now() - offset * DAY_MS).toISOString().slice(0, 10);
const idOf = (handle: string) => `fx_${handle}`;

interface Built {
  profiles: Profile[];
  usage: UsageDoc[];
  agents: AgentDoc[];
  capturedAt: string;
}

let built: { day: string; data: Built } | null = null;

/** Built once per calendar day, so "today" moves with the clock. */
function build(): Built {
  const stamp = dayOf(0);
  if (built?.day === stamp) return built.data;

  const capturedAt = new Date().toISOString();
  const profiles: Profile[] = [];
  const usage: UsageDoc[] = [];
  const agents: AgentDoc[] = [];

  for (const person of CAST) {
    const userId = idOf(person.handle);
    const rand = random(person.handle);

    profiles.push({
      $id: userId,
      handle: person.handle,
      handleLower: person.handle.toLowerCase(),
      name: person.name,
      bio: person.bio ?? null,
      passwordHash: "",
      billing: "api",
      links: person.links ? JSON.stringify(person.links) : null,
      avatarUrl: null,
      isPublic: person.isPublic ?? true,
      listed: person.listed ?? true,
      handleChanges: 0,
      prefs: person.prefs ? JSON.stringify(person.prefs) : null,
      plans: null,
      createdAt: new Date(Date.now() - person.joinedDaysAgo * DAY_MS).toISOString(),
    });

    // Each person's own mix of fresh input, output and cache, so ratios differ between people.
    const mix = { input: 0.02 + rand() * 0.1, output: 0.008 + rand() * 0.04, write: 0.02 + rand() * 0.07 };

    // A slow build-up from the day they joined, then a working rhythm.
    for (let offset = person.joinedDaysAgo; offset >= (person.idleFor ?? 0); offset--) {
      const day = dayOf(offset);
      const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
      const weekend = weekday === 0 || weekday === 6;
      // The last fortnight is always busy, so streaks have something to show.
      const chance = offset < 14 && !person.idleFor ? 0.97 : person.activity * (weekend ? 0.5 : 1);
      if (rand() > chance) continue;

      const ramp = Math.min(1, (person.joinedDaysAgo - offset + 20) / 120);
      const volume = person.scale * ramp * (0.25 + rand() * 1.5);

      for (const tool of ["eaon", "claude-code"]) {
        const share = tool === "eaon" ? person.eaon : 1 - person.eaon;
        if (share <= 0) continue;

        person.models.forEach((model, index) => {
          const weight = index === 0 ? 0.7 : 0.3 / Math.max(1, person.models.length - 1);
          const tokens = Math.round(volume * share * weight * (0.6 + rand() * 0.8));
          if (tokens < 1000) return;

          const rate = RATE[model] ?? RATE["claude-sonnet-4-6"]!;
          const input = Math.round(tokens * mix.input);
          const output = Math.round(tokens * mix.output);
          const cacheWrite1h = Math.round(tokens * mix.write);
          const cacheRead = tokens - input - output - cacheWrite1h;
          const costUsd =
            (input * rate.input + output * rate.output + cacheRead * rate.read + cacheWrite1h * rate.write * 1.6) /
            1_000_000;

          usage.push({
            $id: usageRowId(userId, day, tool, model, false),
            userId,
            day,
            tool,
            model,
            fast: false,
            requests: Math.max(1, Math.round(tokens / 40_000)),
            input,
            output,
            cacheWrite5m: 0,
            cacheWrite1h,
            cacheRead,
            costUsd,
            updatedAt: capturedAt,
          });
        });
      }

      if (person.eaon > 0) {
        const runs = 1 + Math.floor(rand() * 9 * ramp);
        const longestMs = Math.round((3 + rand() * rand() * 140) * 60_000);
        const totalMs = Math.round(longestMs + (runs - 1) * longestMs * (0.15 + rand() * 0.5));
        agents.push({
          $id: agentRowId(userId, day, "eaon"),
          userId,
          day,
          tool: "eaon",
          runs,
          totalMs,
          longestMs,
          updatedAt: capturedAt,
        });
      }
    }
  }

  const data = { profiles, usage, agents, capturedAt };
  built = { day: stamp, data };
  return data;
}

export function fixtureProfiles(): Profile[] {
  return build().profiles;
}

export function fixtureProfile(handle: string): Profile | null {
  return build().profiles.find((profile) => profile.handleLower === handle.toLowerCase()) ?? null;
}

export function fixtureUsage(userId: string): UsageDoc[] {
  return build().usage.filter((row) => row.userId === userId);
}

export function fixtureAgents(userId: string): AgentDoc[] {
  return build().agents.filter((row) => row.userId === userId);
}

/** Everything the board snapshot is built from, in the shapes it reads. */
export function fixtureSnapshotSource() {
  const data = build();
  const totals = data.profiles.map((profile) => {
    const summary = summarize(data.usage.filter((row) => row.userId === profile.$id));
    return {
      userId: profile.$id,
      costUsd: summary.costUsd,
      tokens: summary.tokens,
      requests: summary.requests,
      activeDays: summary.activeDays,
      topModel: summary.topModel,
      lastDay: summary.lastDay,
    };
  });
  return { capturedAt: data.capturedAt, usage: data.usage, agents: data.agents, totals };
}
