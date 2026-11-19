# tokn backend

Supabase-backed persistence and API logic for the leaderboard.

Everything lives in its **own Postgres schema** (`tokn`), separate from the
`eaon` schema in the same Supabase project, so the leaderboard's tables cannot
collide with anything else and can be backed up or dropped as a unit.

The repositories were written against Appwrite, and the tables keep that shape
(same names, `id` holding the old `$id`). `src/client.ts` answers the Appwrite
document calls the repositories make by translating each into one request to
Supabase's Data API, so the move to Postgres did not touch a repository.

```bash
cp ../.env.example ../.env     # fill in SUPABASE_URL and SUPABASE_SECRET_KEY
npm install
npm run provision > schema.sql # SQL for the Supabase SQL editor; only adds what is missing
npm run seed:pricing           # load ~700 model rates
npm run verify                 # end-to-end check against the live database
npm run dev                    # standalone API on :8787
```

## How it fits together

```
  CLI (tokn)                  Dashboard (Next.js)
      |                              |
      |  POST /api/cli/link          |  cookie session
      |  GET  /api/cli/me            |  POST /api/link/code
      |  POST /api/cli/sync          |  GET  /api/leaderboard
      |  POST /api/cli/link-code     |
      |  GET  /api/cli/pricing       |
      +--------------+---------------+
                     |
                 service.ts          one place per operation
                     |
                  repo/*             one module per collection
                     |
      Supabase Data API      schema "tokn"
```

Route handlers stay thin: parse, call a service function, serialise. The
Next.js routes and the standalone server call the *same* service functions, so
they cannot drift apart.

## Collections

| Collection | Rows | Purpose |
|---|---|---|
| `profiles` | one per account | Handle is the public identity. Password is scrypt with a per-user salt. |
| `sessions` | one per browser login | 30-day cookie sessions. |
| `devices` | one per machine | CLI tokens, stored **only as SHA-256**. |
| `link_codes` | short-lived | Single-use codes, expire in 10 minutes. |
| `usage_daily` | one per (user, day, tool, model, fast) | The source of truth. |
| `user_totals` | one per user | Denormalised rollup the leaderboard reads. |
| `pricing` | one per model | Rates served to the CLI. |

No row-level permissions are granted. Every read and write goes through our own
API routes using the server key, which apply their own authorisation. Granting
client access would let anyone holding the public project id read every user's
raw usage.

## The invariant everything rests on

**Writes replace; they never accumulate.**

`tokn sync` re-uploads the user's entire history on every run — that is what
makes backfills and corrections self-healing. Appwrite has no composite primary
key and no `ON CONFLICT`, so upsert semantics come from making the row id a pure
function of the natural key:

```ts
usageRowId(userId, day, tool, model, fast)   // sha256 → 36 chars
```

The same bucket always addresses the same row, so a re-sync overwrites it. If
these ids were random, the second sync would double every number on the
leaderboard. `npm run verify` asserts this explicitly by syncing the same
payload three times and checking the total does not move.

### `tool` is part of the key

Without it, Claude Code and Copilot usage of the same model on the same day
would collide and silently overwrite each other. Rows uploaded by an older CLI
that predates the tool dimension are attributed to `claude-code` rather than
rejected.

### Model ids are grouped, not rewritten

The same model arrives spelled several ways. Claude Code writes
`claude-opus-5-5`, Copilot and OpenRouter write `claude-opus-5.5`, Bedrock adds
`us.anthropic.` and a `-v1:0`, and some logs keep the dated snapshot. Grouped as
raw strings, one model showed up on a profile as two lines with the same label.

`canonicalModelId()` in `src/repo/usage.ts` folds them for display. It runs
`normalizeModelId` from `pricing/catalog.ts` (lowercase; strip region prefixes,
`anthropic.` and `vendor/` prefixes, `-vN[:N]`, `@…` and `-YYYYMMDD`). Then, for
`claude-` ids only, it turns dots into hyphens. Anthropic's own spelling is
hyphens, but elsewhere a dot is the vendor's (`gpt-5.2`). It is applied
wherever usage is grouped by model: `summarize()` here, and `lib/stats.ts` and
`lib/site-stats.ts` in the web app.

**Stored rows keep the id they arrived with.** The row id is derived from it
(above), so rewriting the stored id would orphan every existing row and the
next sync would count them twice.

## Integrity

`src/repo/integrity.ts` judges every uploaded row before anything is written.
Costs are always recomputed from tokens at the server's prices, so the checks
here are about volumes that no machine could have produced. A row over a
ceiling is **rejected, never clamped**. The sync still answers 200 and lists
what it refused in `rejected: [{ day, model, reason, detail }]`, and `costUsd`
counts only what was accepted.

| Limit (`LIMITS`) | Value | Scope | Reason code |
|---|---|---|---|
| `tokensPerRequest` | 20M | one row, all tokens ÷ requests | `tokens-per-request` |
| `outputPerRequest` | 1M | one row, output ÷ requests | `output-per-request` |
| `requestsPerRow` | 250,000 | one row | `requests-per-row` |
| `outputPerDay` | 50M | one account's day | `output-per-day` |
| `tokensPerDay` | 20B | one account's day, all five token kinds | `tokens-per-day` |
| `costPerDayUsd` | $5,000 | one account's day, at server prices | `cost-per-day` |
| `tokensPerSync` | 200B | one whole upload | whole sync refused, HTTP 413 |
| `maxAgeDays` | 400 | how old a row's day may be | |

**The day ceilings are per account, not per row.** A forgery spread across
many tools, models or machines on one day still adds up. `overDay()` adds a day's
uploaded rows to the rows already stored for that day, leaving out any stored
bucket this sync overwrites. If the sum breaks a ceiling, every row this sync
sent for that day is rejected with the same reason. Other days go through.
`cliSync` passes the stored rows in (`assess(rows, { prices, stored })`).

The real heaviest day on record (2026-10-30) was 1.6B tokens, 7.0M output and
$645. The ceilings sit well above that, so a genuine heavy user is not near
them. They exist because a forged row of 501M output tokens and $10,000 in one
day was accepted before them. The tests in `test/integrity.test.ts` include
that forgery, a forged day split across buckets, stored rows counting towards
the day, and the real peak passing.

### Cleaning up rows stored before a ceiling existed

```
npm run audit:usage             list offending rows, change nothing
npm run audit:usage -- --apply  delete them and refresh the owners' totals
```

`src/audit-usage.ts` reads every `usage_daily` row and flags a row if it fails
the per-row checks, or if it breaks a day ceiling **on its own**. Days that are
over a ceiling only in sum are printed as "left alone, look at these by hand"
and never deleted, because which of several rows is the forged one is a
judgement call. `--apply` deletes flagged rows by id, then clears the usage
cache and refreshes totals for every affected account. The board picks it up at
the top of the next hour. It needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY`
(the repo-root `.env` has them, and they point at production). Always run it
without `--apply` first.

## Demo accounts

> **Do not run this against production.** The 70 demo accounts were removed
> from production on 2026-10-01 at the owner's request. The repo-root `.env`
> now points at the production database, so `npm run seed:demo` from a
> checkout puts them straight back on the live board.

```
npm run seed:demo             add 70 accounts with usage, machines and friends
npm run seed:demo -- --remove take them all away again
```

Every row it writes carries `seeded: true` on the profile, which is the only
reason that column exists. Nothing reads it at runtime; it is there so demo
data stays findable once real people sign up. `--remove` finds accounts by that
flag and deletes their usage, devices, friendships, totals and profile —
**real accounts are never touched**, so it is safe to run against a live
database.

The generator is in `src/seed-demo.ts`. Three things it does deliberately:

- **Archetypes, not one generator.** `titan` (runs agents in parallel, a small
  team of one), `whale`, `steady`, `weekend`, `burst`, `ramp`, `taper`,
  `light`, `new`, `lurker`. Titans carry 1.35–2.15x the context per request on
  top of their volume, which is most of why their bills are an order of
  magnitude above the rest and not just a multiple. Each shape has its own day-selection rule, so the
  activity grids have working weeks, weekends and holidays in them rather than
  uniform noise.
- **Rates are read from the `pricing` collection**, not copied into the
  script. The site prices its what-if comparisons from that collection, so a
  second table here would drift and a model would cost one thing in its own row
  and another in the comparison beside it.
- **Models span providers.** Nobody runs one vendor's catalogue and nothing
  else. Who picks what is the interesting part: the heaviest accounts sit on
  frontier models from whoever ships them, hobbyists are on the cheap
  open-weight ones, and accounts drifting away are still on versions from six
  months ago. Every id must exist in `pricing`.
- **A wide spread on cache reuse.** Each account gets a reuse character
  (0.3–2.4x on cache reads), which puts the cohort between roughly 6:1 and
  48:1. With one range for everybody the whole cohort lands on the median and
  the percentile panel says nothing.

Handles are written out rather than assembled: a board where every name is
adjective-plus-noun is the clearest tell that it is fabricated.

**Profile links are deliberately never set, and display names are never full
names.** A demo account linking to a real github.com or x.com profile would
attach a stranger's identity to invented spend.

## Pricing

Rates are built once, in [`pricing/`](../pricing/README.md). `npm run seed:pricing`
is a thin wrapper around that builder: it fetches the
[models.dev](https://models.dev) catalog and upserts every priced model.

The same builder writes the CLI's offline fallback (`cd ../cli && npm run pricing`)
and the daily refresh at `GET /api/cron/refresh-pricing`. A model models.dev
already lists is priced on the next refresh. Rates the catalog cannot express
— Anthropic's 1-hour cache tier, and fast mode — live in `pricing/overrides.json`
and nowhere else.

`GET /api/cli/pricing` serves the Appwrite table. When that table is empty it
is filled before the response; when it is older than a day a refresh is
scheduled after the response. The cron does the same rebuild at 06:15 UTC.
A sync that brings a model with no price does not wait for either: it checks
models.dev on the spot and rebuilds if the model is now listed (see
[`pricing/`](../pricing/README.md)). `priceNewModels` in
`src/refresh-pricing.ts` does the check (an ETag request, at most once per ten
minutes per instance, and it never throws). If anything got priced, the upload
is judged again and the response carries `newlyPriced: string[]`. The web sync
route then revalidates `/api/cli/pricing` and the `model-logos` cache tag, so
the next CLI price fetch and the next page render both see the model.
Set `CRON_SECRET` in the deployment environment or the cron route returns 401.

Until this revision is deployed, production still has whatever the last manual
seed wrote. After deploy, one cron run (or `npm run seed:pricing` against that
database) replaces it. This repo does not ship Appwrite credentials and does
not call production.

## The leaderboard

Ranking by scanning `usage_daily` would mean reading every row of every user on
every page load. Instead each sync recomputes that user's totals into one row in
`user_totals`, and the board is an indexed sort over that — one query regardless
of how much history anyone has.

`user_totals` is derived data and can always be rebuilt from `usage_daily`,
which stays the source of truth.

`rankOf()` counts how many public users score strictly higher rather than
materialising the whole board.

## Agent runs (Eaon Desktop)

`POST /api/cli/sync` takes an optional `agents` array next to `rows`:

```json
{ "rows": [...], "agents": [{ "day": "2026-10-12", "tool": "eaon", "runs": 4, "totalMs": 5400000, "longestMs": 2700000 }] }
```

Each entry is upserted into `agent_daily` on (user, day, tool) and replaces
what that day held, exactly like usage rows. At most 5,000 entries; runs up to
100,000 a day; no single run over 7 days; a total no longer than runs × 7 days.
Small faults (negatives, fractions) are clamped; impossible values are refused
per entry and listed in the reply's `agents.rejected`. An upload without
`agents` leaves stored runs alone. Once someone has any `tool: "eaon"` usage,
the reply carries `eaonProfileUrl` (`https://tokns.eaon.dev/@handle`).

`agent_daily` must be provisioned (`npm run provision`) before runs are stored.
Until then syncs still succeed with `agents.accepted: 0`, and every read
treats the missing collection as "no runs".

## Wiring into the Next.js app — done

`web/` now runs on this backend. `web/src/lib/backend.ts` re-exports the package
and is marked `server-only`; it holds the Appwrite API key and must never be
imported from a client component.

`nextjs/` keeps the original drop-in copies for reference.

**Do not run `npm run build` in `web/` while a `next dev` server is running.**
Both write `.next/`, and the production build leaves the dev server with vendor
chunks it cannot resolve — every page 500s until `.next` is deleted and the dev
server restarted.

### Replacing the SQLite layer

The app currently uses `better-sqlite3` against `data/tokn.db`. The Appwrite
equivalents are drop-in by name, with one difference: **every call is async.**

| SQLite (`lib/auth.ts`) | Appwrite |
|---|---|
| `findUserByHandle(h)` | `await findProfileByHandle(h)` |
| `findUserById(id)` | `await findProfileById(id)` |
| `createUser(h, p, n)` | `await createProfile({ handle, password, name })` |
| `currentUser()` | `await currentUser()` (from `lib/session`) |
| `issueLinkCode(uid)` | `await issueLinkCode(uid)` |
| `redeemLinkCode(c, d)` | `await redeemLinkCode(c, d)` |
| `authenticateDevice(h)` | `await authenticateDevice(h)` |
| `listDevices(uid)` | `await listDevices(uid)` |
| `revokeDevice(u, d)` | `await revokeDevice(u, d)` |

Field names change from snake_case to camelCase (`user_id` → `userId`,
`created_at` → `createdAt`), and the id field is `$id`, not `id`.

## Environment

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_SECRET_KEY` | **Server-side only.** A secret key; it bypasses row-level security. |
| `TOKN_SCHEMA` | `tokn`. Must be an exposed schema in the Data API settings. |
| `TOKN_PUBLIC_URL` | Origin used to build profile links returned to the CLI |
| `CRON_SECRET` | Bearer token for `GET /api/cron/refresh-pricing`. Required in production. |

Locally these are read from the repo-root `.env`, which is gitignored.

## Scripts

| Command | What it does |
|---|---|
| `npm run provision` | Print the schema SQL for the Supabase SQL editor. Idempotent — safe to re-run. |
| `npm run schema:pg` | The raw Postgres DDL generated from `COLLECTIONS` (`provision` wraps it in the schema). |
| `npm run seed:pricing` | Refresh model rates from models.dev via `pricing/catalog.ts`. |
| `npm run audit:usage` | List stored rows over the integrity ceilings; `-- --apply` deletes them. See [Integrity](#integrity). |
| `npm run seed:demo` | Demo accounts. **Not on production.** See [Demo accounts](#demo-accounts). |
| `npm test` | Catalog builder, refresh plan, integrity ceilings and pricing, new-model pricing, logo resolver. |
| `npm run verify` | 29 end-to-end checks against the live database; cleans up after itself. |
| `npm run dev` | Standalone API server on :8787. |
| `npm run typecheck` | `tsc --noEmit`. |

Provisioning is additive: it never drops or alters an existing attribute, so a
schema change that needs that is a deliberate migration, not a deploy side
effect.

## Operational notes

- **Sessions accumulate.** `pruneExpiredSessions()` exists but nothing calls it
  on the request path. Wire it to a scheduled Appwrite Function.
- **Consumed link codes are never deleted.** Harmless (they are refused on
  read) but worth pruning on the same schedule.
- **`globalStats()` pages through every totals row.** Fine to a few thousand
  users; past that, cache it or keep a running counter.
- **Rate limiting is per device and coarse.** `MAX_ROWS` (20,000) caps a
  single upload, and a device syncing again within 10 seconds
  (`MIN_SYNC_INTERVAL_MS`) gets a 429. Nothing limits a user with many
  devices.
