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

`seed:pricing` and the cron route call the same `refreshPricingFromCatalog()`
function. Re-running it overwrites rows; it does not append.

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
multiple is a data edit. Fast mode is `fastInput` / `fastOutput`.

## Tests

```bash
node --experimental-strip-types --test pricing/catalog.test.ts
```

Long-context tiers (GPT-6 charges more above 272K input tokens) are not
applied. Per-request context size is not on every tool's log line, so those
requests are priced at the short-context rate.
