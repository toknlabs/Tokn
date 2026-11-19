# Pricing catalog

One builder for the rates tokn charges against. The CLI offline table, the
Appwrite seed, and the server refresh all start here, so a model that
[models.dev](https://models.dev) already lists does not need a hand-edited
rate in three places.

```
pricing/catalog.ts       fetch, normalise, provider priority, overrides
pricing/overrides.json   Anthropic 1-hour cache and fast mode (the catalog
                         publishes a single cache-write figure)
pricing/render.ts        writes cli/src/core/pricing-data.ts
```

## What runs when

| Who | Command | Writes |
|---|---|---|
| CLI offline snapshot | `cd cli && npm run pricing` | `cli/src/core/pricing-data.ts` (commit it with a CLI release) |
| Local Appwrite | `cd backend && npm run seed:pricing` | `pricing` collection. Needs `APPWRITE_API_KEY`. |
| Production | `GET /api/cron/refresh-pricing` daily, and `GET /api/cli/pricing` when the stored table is empty or older than 24 hours | same collection |
| Production, new models | a sync carrying a model the table cannot price | same collection, only if models.dev now lists it |

`seed:pricing` and the cron route call the same `refreshPricingFromCatalog()`
function. Re-running it overwrites rows; it does not append.

A new model does not wait for the cron. When a sync brings a model with no
price, the server asks models.dev whether the catalog changed (a 304 against
its ETag when it has not, at most once per ten minutes per instance). If the
new catalog prices the model, the table is rebuilt and the sync is judged
again, so the first person to use a model is counted on the day it ships.
See `priceNewModels` in `backend/src/refresh-pricing.ts`.

## Adding a provider

New models under a provider already in `PROVIDERS` are picked up on the next
refresh. A provider models.dev has never listed before needs one entry in
`PROVIDERS` inside `catalog.ts`, ahead of any reseller that restates its ids.
Do not append every reseller: they republish the same models at different
markups, and the first writer wins.

## Overrides

`overrides.json` is the only place for rates the catalog cannot say.
`cache_write` there is the 5-minute tier. Anthropic's 1-hour tier is `2×`
input on current models and is listed explicitly so a future change to that
multiple is a data edit; a model without one is priced at that `2×` anyway.

Fast mode usually needs no override. The catalog lists it as a model of its
own, `<id>-fast`, and the builder copies that rate onto the base model
(`claude-opus-5.5-fast` onto `claude-opus-5-5`). `fastInput` / `fastOutput`
here win over it.

## Model ids

`normalize.ts` holds `normalizeModelId`, re-exported from `catalog.ts`. It is
its own file with no Node imports, so browser code can use it. It trims and
lowercases, then strips region prefixes (`us.`, `eu.`, `apac.`, `global.`,
`ca.`, `sa.`, `apne.`, `usgov.`), `anthropic.`, one leading `vendor/`, a
`-vN[:N]` suffix, an `@…` version and a `-YYYYMMDD` date. A leading `~` is kept.

## Logos

The same models.dev catalog decides whose logo a model gets. Logos show next to
model and tool names on the board, `/stats`, profiles, friends and the Eaon
pages.

| File | Role |
|---|---|
| `logos-core.ts` | Pure rules: which lab a model belongs to, and SVG sanitising. Safe for client code. |
| `logos.ts` | Fetching from models.dev. Imports `catalog.ts`, which uses `node:fs`, so **server only**. |
| `gen-logos.ts` | Writes `web/src/lib/logo-catalog.generated.ts`. Do not edit that file by hand. |

```bash
cd pricing && npm run logos
```

That regenerates the bundled catalog: lab SVGs (35 at the last run), the model
and family to lab mappings that prefix rules cannot infer, and 11 tool logos.
Lab SVGs come from `models.dev/logos/labs/<id>.svg`, falling back to
`models.dev/logos/<id>.svg`. A few tool logos come from
`@lobehub/icons-static-svg` on unpkg (unpinned) and Orca's from GitHub. Aider
and Eaon are drawn by hand. A lab whose SVG fails to fetch is left out; a tool
whose SVG fails aborts the run.

**Which lab wins** (`resolveModelLogoId`): an explicit vendor namespace, then
name prefix rules, then the models.json lookup, then the family, then a
provider that is not a reseller. Resellers (`RESELLER_PROVIDERS`) are a last
resort, so a model is drawn with its maker's mark, never a host's.

**Sanitising** (`sanitizeLogoSvg`). The SVG is rejected if it contains
`script`, `foreignObject`, `iframe`, `object`, `embed` or `image`. Only `g`,
`path`, `circle`, `rect`, `polygon`, `polyline`, `line`, `ellipse`, `defs`,
`clipPath` and `mask` are kept, with `on*`, `class`, `xmlns`, external hrefs and
`javascript:`/`data:` values removed. Every fill and stroke becomes
`currentColor`, so logos are monochrome and follow the theme. models.dev's
default sparkle counts as no logo.

**A model the bundle does not know** is resolved at request time by
`backend/src/refresh-logos.ts`. It tries the static rules first, then a
models.dev refresh (ETag, at most once per ten minutes per instance), then the
`provider` column of the stored price table, then fetches the SVG. In memory,
a fetched SVG is kept 24 hours and a miss 30 minutes. In the web app,
`resolveModelLogos()` (`web/src/lib/logos-server.ts`) answers known models
with no I/O and wraps the rest in `unstable_cache` (one day, tag
`model-logos`). The pricing cron and a sync that prices a new model both
revalidate that tag. `GET /api/logos/<model|tool>/<id>` serves one SVG
(`id` must match `^[a-z0-9][a-z0-9-]{0,63}$`) with a one-day cache. The
components are `ModelLogo`, `ToolLogo`, `ModelName` and `ToolName` in
`web/src/components/BrandLogo.tsx`.

Six labs had no SVG at the last run (baidu, bytedance-seed, ibm, allenai,
sarvam, upstage); they resolve at request time like any new lab.

## Tests

```bash
cd pricing && npm test     # catalog.test.ts and logos.test.ts
```

`backend`'s `npm test` runs `catalog.test.ts` too, plus `backend/test/logos.test.ts`
for the runtime resolver. `web/src/lib/logos.test.ts` is not wired to a script:
`node --experimental-strip-types --test web/src/lib/logos.test.ts`.

Long-context tiers (GPT-6 charges more above 272K input tokens) are not
applied. Per-request context size is not on every tool's log line, so those
requests are priced at the short-context rate.
