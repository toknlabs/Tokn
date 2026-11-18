# Changelog

What changed on toknhq.com and in the `toknhq` CLI, newest first. The READMEs
in each package hold the detail; this file says what shipped and when.

## 2026-11-18

Deployed to toknhq.com from branch `profile-stats-and-integrity`, built on
`owner-eaon-links-live` (84f2865). The CLI part is in `cli/` as 0.1.4 and ships
separately with `npm publish`.

### Profiles

- **New header.** Avatar, name, handle, rank, bio, join date and links sit in
  one header with the share and edit buttons. Below it, a toolbar shows
  all-time totals and the time since the last sync, then jump links to the
  Overview, Activity, Usage and Details groups.
- **New sections:** *rank* (place on the board by this week's and this month's
  spend and all-time tokens), *records* (biggest day, week and month, longest
  streak) and *by weekday* (share of spend on each day of the week). The
  headline figures are now a section too, so they can be moved or hidden.
- **Each section has looks.** For example, the activity grid as squares, by
  month or as numbers, and models and tools as bars, a table or a ring. A look
  changes the drawing, never the figures. Pick them in settings, where each
  one is shown as a small picture.
- **Half or full width.** Two half-width sections in a row share a line. A
  lone half-width section is drawn full width.
- **Customise in place.** Owners get a *customise layout* button on their own
  profile and on `/account`. Each section then has hide, move up, move down
  and width buttons, and hidden sections are listed at the bottom to bring
  back. These are plain form posts, so they work before JavaScript loads.
- **Removed at the owner's request:** spend per day, token mix, where the money
  went, and the 7 and 30 day figures. Saved layouts that named them still load.
  The removed sections are simply not drawn or offered. See `REMOVED_BLOCKS`
  in `web/src/lib/prefs.ts` to bring one back.
- **Fewer words.** Sections lead with figures and drop the explanatory
  paragraphs.
- A section added later shows up in an existing saved layout where it belongs
  in the default order, instead of staying hidden until the owner finds it.
  Sections the owner turned off stay off.

### Across the site

- **Model and tool logos** next to names on the board, `/stats`, profiles, the
  friends board and the Eaon pages. Monochrome, sanitised, from models.dev,
  with new models resolved on first sight. See `pricing/README.md#logos`.
- **`/stats` models section:** a ring with a legend and hover detail, plus a
  full table (spend, tokens, requests, per request, effective rate,
  developers) over the last 30 days.
- **One model, one line.** `claude-opus-5.5`, `claude-opus-5-5` and the Bedrock
  and dated spellings of the same model now group together everywhere usage is
  grouped by model. Stored rows are unchanged.
- **Model labels** read properly for other vendors (`GPT 6 Astra`,
  `DeepSeek v4 Flash`) instead of the Claude dot-join (`Gpt 6.astra`).

### Integrity

- **Per-account daily ceilings:** 50M output tokens, 20B tokens and $5,000 a
  day, plus 1M output tokens per request. A day over a ceiling has every row
  of that sync's upload for that day refused. The rest of the upload still
  counts. The heaviest real day on record is well under all of them (1.6B
  tokens, 7.0M output, $645). The ceilings were added after a forged
  $10,000, 501M-output-token day was accepted.
- **`npm run audit:usage`** in `backend/` lists stored rows that break the new
  ceilings, and deletes them with `-- --apply`. **Not yet run against
  production.**

### Pricing

- **New models are priced on the day they ship.** A sync that brings a model
  with no price checks models.dev right then (an ETag request, at most every
  ten minutes per server instance). If the model is now listed, the table is
  rebuilt and the upload judged again. The response names the model in
  `newlyPriced`.
- Fast-mode rates come from the catalog's `<id>-fast` entries without needing
  an override.

### CLI 0.1.4 (not yet published to npm)

- `tokn scan` and `tokn dashboard` refresh prices from the site when the saved
  table is over a day old (3 second timeout, works unlinked), instead of only
  `tokn sync` doing it.
- `tokn sync` and autosync refetch prices when the server reports
  `newlyPriced`, and say which models were priced.
- Refused rows print once per day and reason. A whole refused day prints as
  "every model" rather than once per row.
- Both spellings of a Claude model merge into one line in local reports.
- Bundled offline price snapshot regenerated (756 models across 25 providers,
  catalog of 2026-10-30).

### Docs

- `backend/README.md`: integrity ceilings and `audit:usage`, model id
  grouping, new-model pricing, scripts table, a warning not to run
  `seed:demo` against production.
- `web/README.md`: profile sections, looks, widths, customise mode, removed
  sections, logos, the CLI sync response.
- `pricing/README.md`: logos pipeline, `normalizeModelId`, tests.
- `cli/README.md`: price refresh in scan and dashboard, `newlyPriced`,
  `rejected`.
