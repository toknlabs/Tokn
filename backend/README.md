# tokn backend

Appwrite-backed persistence and API logic for the leaderboard.

Everything lives in its **own Appwrite database** (`tokn`), separate from the
`eaon` database in the same project, so the leaderboard's tables cannot collide
with anything else and can be backed up or dropped as a unit.

```bash
cp ../.env.example ../.env     # fill in APPWRITE_API_KEY
npm install
npm run provision              # create database, collections, indexes
npm run seed:pricing           # load ~700 model rates
npm run verify                 # end-to-end check against live Appwrite
npm run dev                    # standalone API on :8787
```

## How it fits together

```
  CLI (tokn)                  Dashboard (Next.js)
      |                              |
      |  POST /api/cli/link          |  cookie session
      |  GET  /api/cli/me            |  POST /api/link/code
      |  POST /api/cli/sync          |  GET  /api/leaderboard
      |  GET  /api/cli/pricing       |
      +--------------+---------------+
                     |
                 service.ts          one place per operation
                     |
                  repo/*             one module per collection
                     |
                 Appwrite            database "tokn"
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
| `APPWRITE_ENDPOINT` | `https://sfo.cloud.appwrite.io/v1` |
| `APPWRITE_PROJECT_ID` | `eaon` |
| `APPWRITE_API_KEY` | **Server-side only.** Needs Databases read/write. |
| `TOKN_DATABASE_ID` | `tokn` |
| `TOKN_PUBLIC_URL` | Origin used to build profile links returned to the CLI |
| `CRON_SECRET` | Bearer token for `GET /api/cron/refresh-pricing`. Required in production. |

Locally these are read from the repo-root `.env`, which is gitignored.

## Scripts

| Command | What it does |
|---|---|
| `npm run provision` | Create anything missing. Idempotent — safe to re-run. |
| `npm run seed:pricing` | Refresh model rates from models.dev via `pricing/catalog.ts`. |
| `npm test` | Catalog builder, refresh plan, and integrity pricing. |
| `npm run verify` | 29 end-to-end checks against live Appwrite; cleans up after itself. |
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
- **Row-level rate limiting is not implemented.** `MAX_ROWS` (20,000) caps a
  single upload, but nothing stops a device syncing in a loop.
