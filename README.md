# tokn

Track what AI coding actually costs you.

A command line tool reads the session logs your AI tools already write to disk,
prices the tokens against published API rates, and publishes daily totals to a
leaderboard.

```bash
npm install -g toknhq
tokn
```

That is the whole setup. It finds your tools, shows what you have spent, and
asks whether to link an account and keep it up to date.

## What it reads

Claude Code, Claude Desktop, Codex, GitHub Copilot CLI and opencode. Cursor,
Gemini CLI and Aider are detected and reported as untrackable, because they do
not write per-request token counts to disk. Adding a tool is one adapter
implementing `detect`, `collect` and `lastActivity`.

## What it sends

One line per day, per model: how many requests, how many tokens, what it cost.
Plus a time zone, so day boundaries line up, and the CLI version. Never
prompts, code, file paths or project names.

`tokn sync --dry-run` prints the exact payload before anything leaves the
machine.

## The numbers are estimates

Costs are calculated, not billed: token counts from local logs multiplied by
published API rates. Subscription plans, free tiers, credits and committed-use
discounts are invisible here, so a real invoice will differ. Useful for
comparing your own weeks against each other. Not for expense reports.

Two things make the figures defensible. Records are de-duplicated on message
and request id, because a resumed session rewrites its whole history and would
otherwise double-count — on a real machine roughly half of all records are
repeats. And cache tokens are priced by tier: reads at a tenth of the input
rate, five-minute writes at 1.25×, one-hour writes at 2×. On an agent workload
cache is most of the bill, so collapsing those into one rate is the difference
between a useful number and a wrong one.

## Layout

| | |
|---|---|
| `cli/` | the command line tool — scanning, pricing, sync, terminal dashboard |
| `web/` | the site: leaderboard, profiles, friends, stats |
| `backend/` | data access and service layer, on Appwrite |
| `pricing/` | shared models.dev catalog builder for the CLI fallback and the server table |

Each has its own README covering how it works and why.

## Development

```bash
cp .env.example .env     # fill in Appwrite and GitHub OAuth credentials
cd web && npm install && npm run dev
cd cli && npm install && npm run build && npm link
```

The CLI defaults to `http://localhost:3000`. `TOKN_HOST` points it elsewhere.

## Integrity

The server never stores a number the client chose freely. Costs are recomputed
from token counts against the server's own price table, and submissions that
describe something a machine could not have done are rejected. See
`backend/src/repo/integrity.ts`, which also documents what this does not
prevent.

## Licence

GNU General Public License v3.0 or later. See [LICENSE](LICENSE).
