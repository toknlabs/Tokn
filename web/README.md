# tokn — dashboard

The website half of the AI usage tracker: the leaderboard, public profiles, the
device-link flow, and the four endpoints the CLI talks to.

## Running it

```bash
npm install
npm run seed -- --reset   # 22 demo accounts, ~5 months of usage
npm run dev               # http://localhost:3000
```

Every seeded account signs in with the password `tokn1234`. The seeder prints
which handle has the fullest profile when it finishes.

## Layout

```
src/app/            pages and API routes
src/components/     nav, charts, heatmap, profile body
src/lib/db.ts       SQLite schema and connection
src/lib/auth.ts     accounts, sessions, device tokens, link codes
src/lib/stats.ts    every query the pages make
src/lib/pricing.ts  the rate table served to the CLI
```

Data lands in `data/tokn.db` (gitignored). Point `TOKN_DB` elsewhere to move it.

## The CLI contract

Four endpoints, matching `cli/src/core/api.ts`:

| endpoint | auth | purpose |
| --- | --- | --- |
| `POST /api/cli/link` | none | trade an 8-character code for a device token |
| `GET /api/cli/me` | bearer | who this device belongs to |
| `POST /api/cli/sync` | bearer | upload a scan |
| `GET /api/cli/pricing` | none | the rate table |

**Sync is an upsert keyed on `(user, day, tool, model, fast)`.** A full rescan
must replace a day's figures, never add to them — that is what lets `tokn sync`
run as often as you like and lets a corrected scan heal a bad one. Rows that
fail validation are skipped rather than failing the whole upload. The response
reports `accepted` and `skipped`, lists refused rows in `rejected` (with a
reason, such as a day over the per-account ceilings in
[`backend/README.md`](../backend/README.md#integrity)), names models priced on
the spot in `newlyPriced`, and gives the board's `updatedAt` and
`nextUpdateAt`.

Run the CLI against a local dashboard with:

```bash
TOKN_HOST=http://localhost:3000 tokn link
TOKN_HOST=http://localhost:3000 tokn sync
```

## Link flow

1. `/link` issues a single-use code, valid ten minutes, and polls
   `/api/link/status` while it waits.
2. `tokn link` posts the code to `/api/cli/link` and stores the token it gets
   back.
3. The page flips to "linked" on its own; the machine appears under `/account`,
   where it can be revoked.

Device tokens are stored as SHA-256 hashes, so the database never holds a
credential that could be replayed. Passwords use scrypt with a per-user salt.

## Design

Minimal on purpose. No cards, no shadows, no gradients, no rules between
columns, no background texture. Structure comes from alignment and space.

Themes live in `lib/themes.ts` as five hex values each — `bg`, `alt`, `sub`,
`text`, `main`. `themeStylesheet()` generates the CSS and the layout injects it
into `<head>`; the swatches in the picker read the same array, so a swatch can
never disagree with the palette it selects. Adding a theme is one line.

`--on-main`, the avatar tones and `color-scheme` are derived from luminance
rather than declared.

The boot script sets `data-theme` **and** `data-dark` on `<html>`. Anything
that only needs to know whether the ground is dark — profile accent variants,
generated avatars, the error red — keys off `data-dark` rather than
enumerating theme names.

Generated rules are `html[data-theme="…"]`, which outranks the default palette
block (`:root`) in this file. Plain `[data-theme="…"]` ties on specificity and
leaves source order to decide, which is fragile.

The picker is the left footer chip; the right one opens the release notes from
`lib/releases.ts`. Hovering a theme previews it on the whole page, and only a
click persists.

### Motion

`--ease: cubic-bezier(0.22, 1, 0.36, 1)`, and three durations: `--t-press`
120ms, `--t-fast` 160ms, `--t-base` 240ms. Custom easing only, never `ease-in`
on UI, never `transition: all`, `scale(0.97)` on `:active`, hover behind
`@media (hover: hover) and (pointer: fine)`, and `prefers-reduced-motion`
collapsing every duration.

Two things animate: the four headline figures count up once on first paint
(`Ticker`), and the active filter pill slides between options rather than
cross-fading two backgrounds.

### The account section

Everything belonging to one person lives under `/account`:

```
/account            stats and connected machines
/account/friends
/account/settings
```

`app/account/layout.tsx` supplies the header (avatar, name, totals) and
the tabs. The sign-in check lives there once rather than at the top of every
page — a layout wraps every route beneath it, so no child can be reached
without it. `/settings` and `/friends` remain as permanent redirects, since
those paths shipped in the footer and are in bookmarks.

`ProfileView` takes `identity={false}` inside this section: the layout already
says who you are, and without it the page carries two headers.

### Navigation

The top bar carries only what everyone sees: the board and the site-wide
stats. Anything belonging to one person sits behind their own name in the
account menu, `connect` included — linking a machine is something you do to
your account, not a place you go.

`about` is in the footer. It is a page you read once.

### Account menu

Hovering your handle opens the menu — user stats, friends, public profile,
connect a machine, account settings, sign out. The nav is for what everyone
shares; anything belonging to one person lives behind their own name.

There is no level or XP badge. It was removed deliberately: the site measures
spend, and a cosmetic rank derived from token count invited people to read it
as an achievement. It also cost one indexed document read on every page render
of every route, since the root layout had to fetch totals purely to draw it.

Three details keep the hover honest: the whole wrapper is the hover target
(not just the trigger), a `::before` bridge covers the gap under it, and a
220ms close delay forgives the diagonal path toward an item further down.
Without all three it flickers shut halfway to whatever you were reaching for.
Touch pointers are ignored so a tap toggles instead.

### Passkeys

WebAuthn via `@simplewebauthn/{server,browser}`. Do not hand-roll the
verification: it means CBOR parsing, attestation handling and signature
checking, and a mistake there is a silent authentication bypass rather than a
visible bug.

Only public keys are stored, so this table leaking does not let anyone sign in.
Sign-in is usernameless — `allowCredentials: []` with a discoverable credential,
so nothing is typed and the response never reveals which handles have passkeys.
Passwords keep working; a passkey is an addition.

The challenge lives in a 5-minute httpOnly cookie between the halves of a
ceremony, read-and-deleted on verify, so an unauthenticated sign-in needs no
server state.

**`TOKN_PUBLIC_URL` is the relying party.** Credentials registered under one
rpID cannot be used under another, so changing it invalidates every existing
passkey.

To test headlessly, use CDP's virtual authenticator
(`WebAuthn.addVirtualAuthenticator` with `hasResidentKey` and
`automaticPresenceSimulation`) — no hardware, no prompts. Delete the test
credentials afterwards; they outlive the authenticator that made them.

### The board ranks everyone

`leaderboard()` seeds its accumulator from **profiles, not from usage**, so an
account is ranked from the moment it is created. Signing up is enough; syncing
is what moves you up. A row with nothing in the window renders its figures as
dashes and carries `data-quiet`, which dims it without hiding it.

Private accounts and accounts that opted out are still excluded — see below.
"Everyone" means everyone who has not asked to be left off.

Consequences worth knowing:

- **Ties are broken by join date, not by handle.** Everyone yet to report ties
  at zero, and ordering that block alphabetically would read as a ranking it
  is not. Oldest account first is at least a fact about them.
- **Quiet rows show no movement arrow.** Their rank comes from the tie-break,
  so comparing it with last week measures who else signed up rather than
  anything the account did. Without this an untouched account shows `↓23`.
- **Reconstructing an earlier board excludes accounts that did not exist
  yet.** `previousRanks` passes `until`, and profiles created after it are not
  seeded, so someone who joined this week is new rather than motionless.
- **`rankOf` returns a number for everyone**, so a profile shows its standing
  before its first sync.

A "top ten this month" is a different question from the board, and padding one
with dashes says nothing, so `/stats` and `/api/cli/site` pass
`{ activeOnly: true }`. The board and `/api/cli/board` do not.

### Paging

Fifteen rows a page, with prev/next under the table. `page` lives in the query
string like `period` and `metric`, so every page is linkable and the back
button works.

- **Ranks are assigned before the slice**, in `leaderboard()`. Page two starts
  at 16; it does not restart at 1.
- **Out-of-range pages clamp** rather than 404. A stale link to page 9 of a
  board that has since shrunk should land on the last page.
- **The page count comes from `rankedUsers()`, not from the window.** Every
  account is ranked whether or not it reported, so switching period does not
  change how many pages there are.
- **Changing period or metric drops `page`**, which resets to 1. Staying on
  page 4 while switching metric lands somewhere arbitrary.
- **Your own row is appended when you are not on the page being viewed**, and
  carries `data-detached` for a gap above it. Without the gap the rank jumps
  from 15 to 75 against a 2px row gap and reads as a data error.

The quiet-window note is asked of `globalTotals`, not of the rows on screen:
page three being all dashes is ordinary, and the note is about nobody having
reported at all.

`/api/cli/board` still fetches 100 rows in one go. Paging a terminal table is
the CLI's own question.

### Handles and visibility

A handle can be changed **twice**, ever. The counter is `profiles.handleChanges`
and `HANDLE_CHANGE_LIMIT` lives in `backend/src/repo/profiles.ts`; past the cap
the settings page points at support. Case-only edits (`ada` to `Ada`) are free,
because they do not move the URL.

A rename touches two rows — the handle is denormalised onto `user_totals` so
the leaderboard reads without a join. The profile is written first, so a failed
totals update leaves a stale name on the board rather than two rows disagreeing
about who owns the handle.

Two independent switches govern visibility:

| | |
| --- | --- |
| `isPublic` | can anyone open the profile page |
| `listed` | does the account appear on the leaderboard |

Private implies unlisted, enforced on write by `listedFor()` rather than by
remembering a clause at every read. A public profile may still opt out of being
ranked; its usage keeps counting toward the anonymous site-wide totals, and the
settings copy says so.

A private profile is a 404 to everyone but its owner — not a "this is private"
page, which would confirm the handle exists.

### Profile customisation

`/account/settings` is grouped under headings: profile, appearance, stats,
privacy, security, billing, danger. Grouping is the only structure the page
has — no cards, no borders — so each heading has to say which part of the
account its rows belong to.

`appearance` is how the profile looks (accent, avatar). `stats` is which
numbers it reports (headline figures, sections). Those are different questions
and were confusing while they sat together.

`Appearance.tsx` renders two of those groups itself, which is why it reaches
for `SettingsGroup` rather than the page doing the wrapping.

Owners can change how their page looks, in `/settings`. All of it is
presentation — nothing here changes what is measured or how anyone ranks.

- **Accent** — one of eleven named colours, recolouring the whole profile for
  every visitor (`mono` included, for a profile that wants to be pure type).
- **Avatar** — generated from the handle, first initial on an accent block, or
  the linked GitHub picture.
- **Headline figures** — which four of twelve stats lead the page.
- **Sections** — which sections appear, in what order, at what width, and in
  which look. See [Profile sections](#profile-sections) below.

Stored as a JSON blob in `profiles.prefs`; the vocabulary, defaults and parser
live in `lib/prefs.ts`. The blob holds `accent`, `avatar`, `blocks` (the
visible sections, in order), `stats`, `looks` (only the ones that differ from
the default), `half` (the half-width sections) and `seen`.

`seen` is the list of sections that existed when the blob was written. A
section added later is inserted into an old layout where it sits in the
default order, instead of staying hidden until the owner finds it in settings;
one the owner turned off stays off. Blobs from before `seen` existed are read
as having seen the original seven (`LEGACY_BLOCKS`). An empty `blocks` list is
a real choice and stays empty.

Two rules to keep:

- **Named accents, never a colour picker.** A raw hex cannot satisfy both
  themes — what reads on near-black is invisible on white. Each name carries a
  pair and CSS picks between them.
- **Parsing is total.** A malformed blob, an unknown key or an empty list all
  degrade to something renderable. A profile must never fail to render because
  of a preferences string.

The accent is scoped with `data-accent` on a `display: contents` wrapper.
Everything already reads `var(--main)`, so one attribute recolours the profile
while the site chrome stays put.

**Adding a field means provisioning it.** Putting an attribute in
`backend/src/schema.ts` does not create the column; run `cd backend && npm run
provision` and apply the SQL it prints in the Supabase SQL editor. Until you
do, saves fail with a PostgREST column error in the server log and the form
silently does nothing. A new key inside the `prefs` blob needs none of this.

### Plans

Under `billing`, people can list what they actually pay for: up to eight rows
of provider, plan name, subscription or API, and an optional monthly price.
The list renders on the profile as the `what you pay for` block.

This is the only part of a profile that is **stated rather than measured**.
Everything else comes from session logs; a plan is something only its owner
knows. So the block says so in as many words, and the settings row repeats it:
*nothing here is verified*. Do not add a checkmark, a "verified" badge, or any
treatment that would lend it the confidence the measured figures have.

The price is optional, on purpose. It is what makes the section interesting —
a flat fee next to the API-rate value of the work it carried — and also the
most personal thing on the page, so nobody has to publish it to name a
provider.

Three rules worth keeping:

- **Only subscriptions get compared.** `subscriptionMonthly()` sums the flat
  fees alone. An API plan's monthly figure *is* usage, billed at the very rates
  the site prices everything at, so telling someone their pay-as-you-go account
  "returned 9x" is nonsense. The headline total still includes API plans —
  that is what they pay — and the sentence says "in subscriptions" so the two
  figures reading differently is explained rather than confusing.
- **The comparison window is cut by date, not by row.** `stats.byDay` holds
  only days that had usage, so `slice(-30)` on a twice-a-week account reaches
  back four months while the sentence claims thirty days. `spendSince()` takes
  a real cutoff.
- **The block renders without usage.** It is the one section that needs no
  data, and a new account that has listed its stack but not yet synced still
  has something to show.

`lib/plans.ts` holds the provider catalogue, parsing and the totals;
`components/PlanFields.tsx` is the editor. Its rows are plain inputs named
`plan.*` that the server action reads as parallel arrays, so **every field has
to be submitted on every row or the indexes slip** — that is why the custom
provider name is still rendered, as `type="hidden"`, when the provider is not
`other`. Saving also rewrites `profiles.billing` from the list
(`billingFromPlans`), because a `plan` tag on the leaderboard that contradicts
the plans on the profile is worse than either alone.

### The about page

One column, read top to bottom, in sections, at the same 42rem measure the
legal pages use. `.prose-page` is a three-column grid — gutter, measure,
gutter — so a section marked `bleed` can break out to full width. Only the
figures band does; it reads as a band at full width and as a list inside the
measure.

There is no rate card here. `lib/pricing.ts` is still the source of truth for
what anything costs, and the cache multipliers are stated in prose in step two
of "how it works", but the page is a read rather than a reference table.

**Every number on it is read live.** A page whose whole claim is that the
project measures things rather than guessing should not carry a figure someone
typed in by hand.

The figures are all-time, and that took a fix: `siteStats` computes `byDay`,
`byModel` and `byTool` *inside* the rolling window, so "tools seen" and "days
recorded" taken from those were 30-day numbers under an all-time caption.
`allTime.models` and `allTime.days` count distinct models and days over the
whole history, in the same single pass.

### The models section

`components/ModelMix.tsx` on `/stats`: a ring with a legend, then a full table.
Two questions, so two views of the same rows — the ring is a share and only has
to be read at a glance, the table is a comparison and needs columns.

The ring is ordered by **tokens** and the table by **spend**, and they
genuinely disagree (a cheap model can carry a third of the work for two percent
of the bill). That is the point of showing both, and the footnote says so
rather than leaving a reader to spot it.

Two things that took a second pass:

- **The shade ramp is written out, not interpolated.** A linear ramp put the
  top two stops within a few percent of each other, so the two largest arcs
  read as one solid band — the exact comparison the chart exists to make.
  `RAMP` steps steeply (100, 58, 38, …) following the cost bar's precedent, and
  floors well above the background so the smallest slice stays visible.
- **Arcs are separated by a hairline.** With one hue at six strengths,
  neighbours are close by design; the gap is what keeps two of them legible as
  two. It is clamped so a sliver does not go negative and wrap the ring.

Five colours cannot give eight models eight hues, so the tail folds into one
`other` slice and every segment is named in the legend. The shade never has to
carry the meaning alone.

Per-model developer counts come from a `users` set in `siteStats`, mirroring
what `byTool` already did.

`modelLabel` in `lib/pricing.ts` handles both naming conventions. Anthropic ids
are hyphen-separated digits — `claude-haiku-4-5` means 4.5 — so those segments
join with dots. No other provider names models that way: `gpt-6-astra` and
`deepseek-v4-flash` are words, and the old dot-join rendered them "Gpt 6.astra"
and "Deepseek v4.flash". Non-Claude ids join with spaces, with a small table of
families whose capitalisation is not just first-letter-upper (GPT, GLM,
DeepSeek).

**Hovering reports a model.** `ModelRing.tsx` is the client half — the ring and
legend — so the table stays server-rendered and ships no JavaScript. Pointing
at an arc or a legend row dims the rest, swaps the ring's centre, and fills in
the line underneath: tokens, spend and its share, requests, developers.

Four decisions there:

- **The detail line is always populated**, showing the largest model at rest.
  A strip that appears on hover shoves the table down the page every time the
  pointer crosses the chart, and reserving an empty gap is worse than filling
  it with something true.
- **No floating tooltip.** A box tracking the cursor is chrome this design does
  not have anywhere else, and it is unreachable by keyboard and useless on a
  phone.
- **Arcs and legend rows are real buttons**, so hover, tap and Tab all do the
  same thing.
- **The active arc widens rather than just staying bright.** A slice low on the
  ramp is dark to begin with, so leaving it at full opacity while the others
  fade still reads as "everything is dim". Stroke width is independent of
  shade, so it marks the sixth slice as clearly as the first.

The table's columns are model, spend, share of spend, tokens, share of tokens,
requests, per request, effective rate and developers, over the last 30 days.
Models are grouped by `canonicalModelId`, so `claude-opus-5.5` and
`claude-opus-5-5` are one row here, on profiles and in the about page's model
count (see [`backend/README.md`](../backend/README.md#model-ids-are-grouped-not-rewritten)).

### Model and tool logos

Model and tool names carry their maker's logo on the board's top-model column,
`/stats` (ring, table and tool bars), profiles, the friends board
(`topModelLogo` in `/api/friends/board`) and the Eaon pages. The components are
`ModelLogo`, `ToolLogo`, `ModelName` and `ToolName` in
`components/BrandLogo.tsx`. A page calls `resolveModelLogos()` from
`lib/logos-server.ts` once with every model it will show and passes the
resulting `logoMap` down. Known models resolve from the bundled
`lib/logo-catalog.generated.ts` with no I/O. A model the bundle does not know
is looked up on models.dev (cached a day under the `model-logos` tag). If only
its lab id is known, the logo is drawn as a CSS mask over
`/api/logos/model/<id>`. Logos are sanitised to `currentColor`, so they follow
the theme. The pipeline, sources and sanitiser are in
[`pricing/README.md`](../pricing/README.md#logos).

`ShareBars` and `PagedBars` rows take an optional `icon`, which is how the
logos get into the bar charts.

### Profiles

`/profile/<handle>` is a stack of blocks with nothing drawn around them: a
label, the figure, and the shape of it. Avatars are generated from the handle
(`components/Avatar.tsx`) and take their lightness from `--av-base` /
`--av-tint` so the same mark works on both themes — there is nothing to upload
and no broken image state.

Profile links live in a JSON array on the user row. `lib/links.ts` derives the
provider from the host, so a user pastes a link and the right icon and label
appear; anything unrecognised gets a globe and its hostname, which keeps
personal sites first-class. `normalizeLink` accepts bare hosts and rejects
anything that is not http(s), so `javascript:` can never reach an href.

The page is `components/ProfileView.tsx`, shared by `/profile/<handle>` and
`/account`. From the top: one header with the avatar, name, handle, rank and
private/unlisted tags, the share and edit buttons, bio, join date and links;
then a toolbar ("Usage overview", all-time totals, time since the last sync)
holding the owner's **customise layout** button; then a row of jump links
(Overview, Activity, Usage, Details) to the first visible section in each
group; then the sections.

#### Profile sections

Every section is one entry in `BLOCKS` in `lib/prefs.ts`, with a label in
`BLOCK_LABELS` and a list of looks in `LOOKS`. Offered today:

| Key | Label | Looks (first is the default) |
|---|---|---|
| `figures` | headline figures | large, small |
| `activity` | activity grid | squares, by month, numbers |
| `standing` | rank | cells, list, tags |
| `models` | models | bars, table, ring |
| `tools` | tools | bars, table, ring |
| `records` | records | cells, list |
| `rhythm` | by weekday | columns, bars |
| `plans` | what you pay for | list |
| `summary` | summary table | grid, list, cells |

`rank` only appears when the account is on the board and `what you pay for`
only when plans are declared. Records are the biggest day, week and month and
the longest streak; by weekday is the share of spend falling on each day of
the week. Both are computed in `lib/profile-stats.ts`.

**Removed on 2026-11-17, at the owner's request:** `spend` (spend per day),
`tokens` (token mix), `costs` (where the money went) and `lately` (last 7 and
30 days). They are listed in `REMOVED_BLOCKS` and remain in `BLOCKS`, so old
blobs that name them still parse and `seen` keeps recording them. `parsePrefs`
drops them, so the profile, its customise mode and the settings form never
draw, offer or reorder them. Their renderers (`DailySpend.tsx`,
`CostAnatomy.tsx`, the token views) are still in the tree. To bring one back,
take it out of `REMOVED_BLOCKS`. Owners whose saved layout named it will get it
back where they had it.

**Looks change the drawing, never the figures.** Each look of a section takes
the same rows its siblings do. The shared renderers are in
`components/ProfileLooks.tsx` (`Figures`, `Columns`, `Breakdown`, `SplitBar`)
and `components/Cells.tsx`. Settings shows a small picture of each look from
`components/LookGlyph.tsx` rather than only a word. Only non-default looks are
stored.

**Widths.** Sections are full width or half width. `layout()` in
`ProfileView.tsx` pairs consecutive half-width sections two to a row, in the
owner's order. A half-width section with no partner is drawn full width,
because a lone half leaves a hole. Every `.pblock` is a size container
(`container-type: inline-size`), so a section reflows to its own width at
560px and does not need to know whether it is paired. Under 720px everything is
one column.

**Two places to change the layout:**

- `/account/settings`, under *sections*: a checkbox, up/down arrows, look
  buttons and a full/half toggle for every offered section, saved with the
  rest of the form.
- On the profile itself: **customise layout** (`?customise=1`, owner only)
  gives each section hide, ↑, ↓ and width buttons, and lists hidden sections at
  the bottom with a button to bring each back. Each button is a plain form post
  to the `changeLayout` server action in `app/profile/actions.ts`, so it works
  before JavaScript loads. The action only ever edits the signed-in user's own
  layout (no user id travels in the form). It returns to `/account` or the
  owner's own profile, never anywhere the form names, and lands on the edited
  section with `#<block>`. `savePrefs` in `lib/auth.ts` writes only the
  `prefs` column; `saveProfile` would blank the fields the form did not send.

**Hover panels keep a fixed height.** A detail panel under a chart that grows
or shrinks with the hovered item moves the chart under the pointer, which
changes the hovered item, which resizes the panel again. The profile once
jittered like that. Panels that follow the pointer reserve their largest shape
up front (fixed rows, hidden rather than removed when empty). See
`DailySpend.tsx` and `ModelRing.tsx`.

## The footer

One row: icon-and-label links on the left — stats, about, connect, settings,
github, x, terms, privacy — and the theme picker and version chip held to the
right edge, since those are controls rather than destinations. On a phone the
links wrap to two rows and the chips follow. Icons come from
`components/Glyphs.tsx`; brand marks from `components/SocialIcon.tsx`.

`Glyphs.tsx` exists so the same idea keeps the same mark. The plug in the
account menu and the plug in the footer are one path, and stay that way when
one of them is redrawn.

## Links

`lib/site.ts` holds the GitHub and X URLs, the X handle, and `ISSUES_URL`. One
place, because they appear in the footer, on the about page, in the terms and
privacy pages, in settings and in the Twitter card metadata — and a link that
is stale in one of six spots is what happens when they are typed out each time.

`ISSUES_URL` is the repo's issue tracker, not the organisation page. Terms and
privacy both promise that questions and data requests are handled by opening an
issue, so the link has to land somewhere that has one.

- source: https://github.com/toknlabs/Tokn
- x: https://x.com/trytokn

## Notes

- `tokn unlink` only clears local config; it does not revoke the token
  server-side. Use the revoke button on `/account` for that.
- SQLite is a deliberate local-first choice. Everything touching it is behind
  `src/lib/db.ts`, so swapping in Postgres for deployment is one file plus the
  query helpers in `stats.ts`.
- Do not run `npm run build` while `next dev` is running. It overwrites `.next`
  and every page starts 500ing with a React Client Manifest error. Kill dev,
  `rm -rf .next`, restart.
- Never put `position: sticky` on a `<thead>` inside `.table-wrap`. That
  wrapper has `overflow-x`, which makes it the sticky containing block in
  *both* axes, so a `top` offset parks the header partway down the table and
  hides the first row. This bit twice before the tables went flat.
- Nothing time-dependent may be computed during render in a client component.
  `LinkPanel` seeded its countdown from `Date.now()` and hydrated with a
  mismatch on every load; it now starts at the constant TTL and corrects in an
  effect.
- The leaderboard page runs several full-table scans per request
  (`previousRanks`, `modelMix`, `rankOf`). Fine at this size; the first thing
  to optimise when the board grows past a few thousand rows.
