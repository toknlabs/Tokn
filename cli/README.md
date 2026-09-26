# tokn

Track your AI coding usage across every CLI you use, and publish it to the
leaderboard.

```
npm install -g toknhq
tokn setup
```

`tokn setup` scans your machine, shows you what it found, and then asks whether
you want to publish any of it. Nothing is sent before you say so, and every
step can be declined.

Afterwards, plain `tokn` is your dashboard: total spend, a year-long activity
graph, a per-model breakdown, and whether auto-sync is running.

Zero runtime dependencies — the install is one package.

## Commands

| Command | What it does |
|---|---|
| `tokn` | A quick look at your usage: spend, activity graph, models |
| `tokn dashboard` | The whole site, full-screen in your terminal |
| `tokn setup` | Guided first-time setup |
| `tokn link` | Connect this machine to your dashboard account |
| `tokn status` | Show where this machine points and whether the link works |
| `tokn sources` | Show which AI tools are detected and tracked |
| `tokn scan` | Read local usage and show it — uploads nothing |
| `tokn sync` | Scan, then publish aggregates to the leaderboard |
| `tokn autosync on` | Publish automatically from a Claude Code hook |
| `tokn unlink` | Forget the stored credential |

`tokn auth login` / `auth status` / `auth logout` work as aliases, and
`tokn ui` / `tui` / `browse` all open the dashboard.

## The terminal dashboard

`tokn dashboard` is the website, drawn in your terminal and driven from the
keyboard. Four tabs mirror four pages — the leaderboard, a profile, your
friends board, and site-wide stats — and Enter on any row opens that person's
profile, the same way clicking their handle does on the site.

```
1 2 3 4     jump to a tab            p   period: day … all time
tab         next tab                 m   rank by cost, tokens, requests
↑ ↓ / j k   move or scroll           w   friends window
⏎           open the profile         r   refresh
esc         back                     o   open this view in a browser
g / G       top / bottom             ?   help
                                     q   quit
```

It is **read-only, by construction**. The four endpoints behind it are all
GET, and there is no write path in the CLI at all. Your handle, profile,
friends and settings are editable on the site only — a linked machine can
upload usage and read, and that is the whole of its authority.

The numbers are the page's numbers: it calls the same functions the server
components call, with the same arguments, so a rounding rule fixed in one
place is fixed in both. That includes the website's three separate money
formats, which are reproduced rather than smoothed into one.

Needs an interactive terminal. Piped or redirected it prints a short message
and suggests `tokn scan --json`. `q` exits 0; Ctrl-C exits 130.

### Flags

```
--last <n>     Only the last n days               (scan, sync)
--since <d>    Only from YYYY-MM-DD onward        (scan, sync)
--tools        Break down by tool instead of model (scan)
--days         Break down by day instead of model  (scan)
--tool <id>    Only this source, e.g. claude       (scan)
--json         Machine-readable output             (scan, sources)
--dry-run      Show what would upload, send none   (sync)
```

## Supported tools

Run `tokn sources` to see what is present on your machine.

**Tracked** — usage is recorded locally and can be accounted for:

| Tool | Where it reads from |
|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` |
| Claude Desktop | `~/Library/Application Support/Claude/local-agent-mode-sessions/**` |
| Codex CLI | `~/.codex/sessions/**/*.jsonl` (`token_count` events) |
| GitHub Copilot CLI | `~/.copilot/session-store.db` → `assistant_usage_events` |
| opencode | `~/.local/share/opencode/opencode.db` → `message` |

**Detected but not countable.** Not every AI CLI writes token usage to disk.
Some bill by subscription and keep usage server-side; others log only
conversation text. tokn reports these explicitly rather than counting them as
zero — otherwise you cannot tell "I didn't use it" from "it can't be read":

| Tool | Why |
|---|---|
| Cursor | Stores no token counts locally. Every blob across `~/.cursor/chats/*/*/store.db` was checked — 18,339 blobs, 1,968 assistant messages, zero usage fields. Usage lives in the Cursor dashboard. |
| Gemini CLI | No local usage records; its telemetry export would be needed. |
| Aider | Writes chat history without per-request token accounting. |

SQLite-backed sources (Copilot, opencode) use Node's built-in `node:sqlite` and
need **Node 22.5+**. On older Node they report as unavailable and the rest of
the scan proceeds normally.

### Adding another tool

Write one adapter in `src/core/sources/` implementing `Source` — `detect()`,
`collect()`, and optionally `lastActivity()` — then add it to the array in
`registry.ts`. Nothing downstream changes: pricing, aggregation and upload are
written against the normalized `UsageEvent` alone.

## Linking

The dashboard issues a short code and you paste it into the CLI:

```
$ tokn link

  Link this machine to your tokn dashboard

  1. Open http://localhost:3000/link
  2. Copy the code shown on that page
  3. Paste it below

  Code: A1B2-C3D4

  ✓ Linked as @sanshray
```

Codes are accepted in any case, with or without the dash. This direction (code
travels dashboard → CLI) needs no local callback server, so it works unchanged
over SSH and inside containers.

The token is written to `~/.tokn/config.json` with mode `0600`.

## Automatic publishing

```
tokn autosync on              # install, every 90 minutes
tokn autosync on --every 120  # or pick your own interval
tokn autosync status          # what is running, and when it last ran
tokn autosync off             # remove everything
```

Three triggers, because no single one is enough:

| Trigger | Covers |
|---|---|
| **Every 90 minutes**, via the OS scheduler | Every tool, whether or not any editor is open |
| **23:59 local time**, daily | Closes the day out on fresh figures |
| Session store changes, and Claude Code session start/end | Makes a new session publish promptly instead of waiting |

The Claude Code hook alone was never enough: it only fires for Claude Code, so
it misses Claude Desktop, Codex, Copilot and opencode, and nothing guarantees a
session starts at 23:59. The periodic and daily runs are registered with the
operating system:

- **macOS** launchd, `~/Library/LaunchAgents/dev.tokn.{autosync,daily}.plist`
- **Linux** systemd user timers, `~/.config/systemd/user/tokn-*.timer`
- **Windows** no scheduler yet; the Claude Code hook still works

A scheduled job runs with a minimal environment, so the plists and units spell
out absolute paths to both `node` and the CLI rather than relying on `PATH`.

The daily run passes `--daily`, which **bypasses the throttle**. Without that, a
periodic sync at 23:30 would make the 23:59 run a no-op and the day would close
on stale numbers.

Because it runs unattended inside someone else's coding session, it follows
three rules:

**It never blocks.** The Claude Code hook is registered with `async: true`, so
the session does not wait for it. The scheduled jobs are `Background` priority
with `Nice 5` and low-priority IO.

**It never speaks.** No stdout, no stderr, nothing in the transcript. The
scheduled jobs send both streams to `/dev/null`; results go to
`~/.tokn/autosync.log` (last 100 lines).

**It never fails.** Every path exits 0. A usage tracker must not be able to
disrupt a coding session, whatever goes wrong.

Three guards keep the cost near zero:

- **Throttle** — at most one sync per interval, so a burst of file activity
  produces one sync rather than dozens.
- **Stat pre-check** — if no tool has written anything since the last sync, it
  exits in ~50ms without parsing.
- **Lock** — opening six terminals at once produces one sync, not six.

Nothing is lost by skipping a run: every sync is a full scan that upserts.

Installing merges into your existing Claude Code hooks rather than replacing
them, is idempotent, writes atomically, and refuses to touch `settings.json` if
it cannot parse it. `off` removes the hook and both scheduled jobs.

## Two things that make the numbers correct

**De-duplication.** Claude Code rewrites assistant records into a new transcript
whenever a session is resumed or forked, and copies subagent turns into the
parent. On a real machine **about half of all usage records are repeats**. Every
record is keyed on the API's own `message.id` + `requestId` and counted once, so
a resumed session does not inflate your total. `tokn scan` reports how many
duplicates it ignored.

**Cache tokens are priced by TTL.** Anthropic cache writes cost 1.25× the input
rate at a 5-minute TTL but 2× at one hour, and real agent workloads are
overwhelmingly 1-hour writes. Collapsing them into one bucket understates the
bill badly, so the two are tracked and priced separately.

Locally generated `<synthetic>` records were never sent to any API and are
excluded. Reasoning tokens are not added on top of output tokens — every
provider here already bills them inside `output`.

## Pricing

Generated from the [models.dev](https://models.dev) catalog by the shared
builder in [`pricing/`](../pricing/README.md), and spot-checked against
Anthropic's published rates. `npm run pricing` rewrites `src/core/pricing-data.ts`.
Model ids are normalized before lookup, so dated snapshots
(`claude-haiku-4-5-20251001`), Bedrock prefixes (`us.anthropic.…`), Vertex
`@`-versions and `vendor/model` spellings all resolve to one row. A leading
`~` is kept, so an alias like `~openai/gpt-luna-latest` stays its own row.

Where a provider publishes explicit cache rates we use them; otherwise:

| Bucket | Rate |
|---|---|
| Cache read | 0.10 × input |
| Cache write, 5m TTL | 1.25 × input |
| Cache write, 1h TTL | 2.00 × input (Anthropic only) |

A model with no known rate is **reported as unpriced, never counted as $0** — so
the total cannot silently understate. Where a tool computed its own cost
(opencode does), that is used as a fallback for models we cannot price.

`tokn sync` refreshes the table from the dashboard first, so a model released
after this CLI shipped is still priced correctly. Regenerate the built-in table
with `npm run pricing`.

**Known limitation:** context-tiered pricing (some models charge double above
200K context) is not applied — per-request context size is not reliably
recorded by every tool. Long-context usage on those models is priced at the base
rate.

## What gets uploaded

Aggregates only. One row per (day, tool, model):

```json
{
  "day": "2026-09-18",
  "tool": "claude-code",
  "model": "claude-opus-5",
  "requests": 412,
  "input": 1204,
  "output": 259,
  "cacheWrite5m": 0,
  "cacheWrite1h": 20769,
  "cacheRead": 21350,
  "costUsd": 0.318,
  "fast": false
}
```

Alongside the rows the request carries three things and nothing else: your
IANA time zone (so a day boundary means the same on both ends), the time of
the scan, and the CLI version.

No project names, no file paths, no git branches, no prompt or response text.
Run `tokn sync --dry-run` to see exactly what would be sent before sending it.

## Server contract

Four endpoints. This is everything the dashboard needs to implement.

### `POST /api/cli/link`

Exchange a dashboard-issued code for a device token. Unauthenticated.

```jsonc
// request
{ "code": "A1B2-C3D4",
  "device": { "hostname": "ada.local", "platform": "darwin", "cliVersion": "0.1.0" } }

// 200
{ "token": "tok_…", "user": { "id": "u_1", "handle": "sanshray", "name": "Sanshray" } }
```

Codes should be single-use and short-lived. Return `404` for an expired or
already-redeemed code, `400` for a malformed one; the CLI renders the `error`
field verbatim.

### `GET /api/cli/me`

Bearer token. Returns `{ "user": … }`, or `401` if the token has been revoked —
the CLI then tells the user to re-link.

### `POST /api/cli/sync`

Bearer token.

```jsonc
{ "rows": [ /* the row shape above */ ],
  "timezone": "America/Los_Angeles",
  "scannedAt": "2026-09-18T06:30:00.000Z",
  "cliVersion": "0.1.0" }

// 200
{ "accepted": 137, "rank": 3, "profileUrl": "https://toknhq.com/profile/sanshray" }
```

**Rows must upsert on `(user, day, tool, model, fast)` — never append.** The CLI
is stateless and re-sends the full history on every sync, so replacing a row is
what makes backfills and corrections self-healing. Appending would multiply
every total on the second sync.

`rank` and `profileUrl` are optional; the CLI shows them when present.

Days arrive as the user's **local** calendar days, which is why `timezone` is
included.

### `GET /api/cli/pricing`

Unauthenticated. Returns the pricing table:

```jsonc
{ "models": {
    "claude-opus-5": { "input": 5, "output": 25,
                       "cacheRead": 0.5, "cacheWrite": 6.25,
                       "fast": { "input": 10, "output": 50 } },
    "gpt-5.2": { "input": 1.75, "output": 14, "cacheRead": 0.175 }
} }
```

Rates are USD per million tokens. `cacheWrite1h` is supported for Anthropic
models. Return `{ "models": {} }` and the CLI keeps its built-in table.

### Read endpoints for `tokn dashboard`

Four more, each mirroring one page of the site. All `GET`, all Bearer-authed
with the device token, and all read-only — nothing a device token reaches can
change an account.

| Endpoint | Query | Returns |
|---|---|---|
| `GET /api/cli/board` | `period`, `metric` | The leaderboard, plus movement, a 14-day series per user, and your own row when you are off the end |
| `GET /api/cli/profile` | `handle` (omit for your own) | One profile: stats, cost anatomy, reuse benchmark, burn rate, what-if |
| `GET /api/cli/friends` | `window`, `metric` | Friends board and roster, including pending requests |
| `GET /api/cli/site` | — | Site-wide stats and the month's top ten |

`/api/cli/profile` applies the website's privacy rule: a private profile that
is not yours and not a friend's returns `404`, identical to one that does not
exist. Distinguishing them would confirm the handle exists, which is what
making it private was meant to prevent.

## Environment

The dashboard lives at `https://toknhq.com`. Until it is deployed there the
CLI still defaults to `http://localhost:3000` — see `PRODUCTION_HOST` in
`src/core/config.ts`. Point it anywhere with `TOKN_HOST`:

```bash
TOKN_HOST=https://your-host tokn link
```

| Variable | Effect |
|---|---|
| `TOKN_HOST` | Dashboard base URL (default `http://localhost:3000`) |
| `TOKN_TOKEN` | Use this token instead of the stored one (CI) |
| `TOKN_CONFIG_DIR` | Override `~/.tokn` |
| `CLAUDE_CONFIG_DIR` | Where Claude Code keeps its sessions |
| `CODEX_HOME` | Where Codex keeps its sessions |
| `NO_COLOR` | Disable colour |
| `TOKN_DEBUG` | Print stack traces on unexpected errors |

## Exit codes

`0` success · `1` operational failure · `2` usage error · `130` cancelled

## Development

```bash
npm install
npm run build
npm run pricing      # regenerate the model price table from models.dev
npm test             # lookup against the generated catalog
node dist/index.js scan
```
