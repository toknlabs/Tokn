# Changelog

What changed on toknhq.com and in the `toknhq` CLI, newest first. The short
version people see on the site, under the version number in the footer, comes
from `web/src/lib/releases.ts`. Update both when you ship. The READMEs in each
package have the detail.

## 0.6.0, 18 November 2026

Everything since 0.5.0 on 21 September. Deployed from
`profile-stats-and-integrity` at 097f2b1, which sits on top of
`owner-eaon-links-live`.

### Profiles

Owners get a "customise layout" button on their own profile and on `/account`.
It puts hide, move up, move down and width buttons on every section, and lists
the hidden ones at the bottom so they can come back. The buttons are plain form
posts, so they work before the page's JavaScript has loaded.

Most sections have a few looks now. The activity grid can be squares, months or
numbers; models and tools can be bars, a table or a ring. A look changes how
the section is drawn and never the figures in it. Settings shows each look as a
small picture. Sections can also be half or full width, and two half-width
sections in a row share a line (a lone one is drawn full width).

There are three new sections: rank (where you stand by this week's spend, this
month's spend and all-time tokens), records (biggest day, week and month, and
the longest streak) and by weekday (how your spend splits across the week). The
headline figures became a section too, so they move and hide like the rest.

The top of the profile is one header now: avatar, name, handle, rank, bio, join
date, links, and the share and edit buttons. Under it is a toolbar with
all-time totals and the time since the last sync, then links that jump to the
Overview, Activity, Usage and Details groups.

Four sections are gone because the page was crowded: spend per day, token mix,
where the money went, and the last 7 and 30 days. A saved layout that names
them still loads; they just aren't drawn or offered. `REMOVED_BLOCKS` in
`web/src/lib/prefs.ts` is where to bring one back. The sections that stayed
lead with numbers and dropped most of their explaining sentences.

A section added in a later release now shows up in an existing saved layout,
in its default place, instead of staying hidden until the owner goes looking.
Sections an owner turned off stay off. The savings panel and the subscription
verdict are only shown to the profile's owner.

### Across the site

Model and tool names have logos next to them on the board, `/stats`, profiles,
the friends board and the Eaon pages. They are monochrome SVGs from models.dev,
cleaned before use, and a model nobody has seen before gets its logo looked up
the first time it appears. `pricing/README.md#logos` explains the pipeline.

`/stats` has a models section: a ring with a legend, and a table of spend,
tokens, requests, cost per request, effective rate and developers for each
model over the last 30 days.

The same model under different spellings is grouped as one. That covers
`claude-opus-5.5` and `claude-opus-5-5`, plus the Bedrock and dated forms.
Stored rows keep their original ids. Names from other labs also read better:
`GPT 6 Astra` and `DeepSeek v4 Flash` instead of `Gpt 6.astra`.

Clicking a link shows a skeleton of the next page straight away rather than
leaving the old page up while the server works. Warm, the board went from
0.68s to 0.25s, a profile from 1.54s to 0.26s and `/stats` from 2.43s to 0.20s.
The board refreshes hourly from a snapshot, and your own pages show a sync the
moment it lands.

### Sign in with tokn

Desktop apps can sign people in with tokn and publish usage for them (OAuth 2.0
with PKCE and loopback redirects; see `backend/OAUTH.md`). The token is an
ordinary device token, so it shows on the account page and can be revoked like
a machine. Eaon Desktop and Orca are the registered apps. Someone who signs up
partway through an app's sign-in goes through the setup walkthrough first and
then back to the app, and GitHub sign-ups get the walkthrough as well.

`/account/owner` lists who has linked an app this way. Only the profile ids in
`TOKN_OWNER_IDS` can open it; everyone else gets a 404.

A redirect to `127.0.0.1` used to come back as `localhost`, because Next
normalises `request.url`. The authorize route reads the URL as sent now.

### Integrity

Each account now has daily limits: 50M output tokens, 20B tokens and $5,000,
plus 1M output tokens per request. A day over any of them is refused for every
row in that upload for that day, and the rest of the upload still counts. The
heaviest real day on record is 1.6B tokens, 7.0M output and $645, well under
all three. The limits went in after the board accepted a forged $10,000 day
with 501M output tokens.

`npm run audit:usage` in `backend/` lists stored rows that break the limits,
and deletes them with `-- --apply`. It has not been run against production
yet, so the forged day is still in the database.

### Pricing

The CLI fallback, the server's price table and the daily refresh all read one
catalog built from models.dev (`pricing/catalog.ts`).

A sync that brings a model with no price checks models.dev right away, with an
ETag request at most every ten minutes per server instance. If the model is
listed, the table is rebuilt and the upload judged again, and the response
names the model in `newlyPriced`. Fast-mode rates come from the catalog's
`<id>-fast` entries without an override.

### Storage

Data moved from Appwrite to Supabase Postgres, into the `tokn` schema with the
same table and column names. `backend/src/client.ts` answers the Appwrite calls
the repositories make, so none of them changed.

### CLI

0.1.3 is on npm. After a command it checks for a newer release and offers to
install it, verifying the download against the registry's sha512 first. It
stays quiet for `--json`, pipes, cron and `TOKN_NO_UPDATE_CHECK`. The account
page warns about machines running a CLI too old to update itself. One command
run with `TOKN_HOST` set no longer leaves the CLI pointed at that server.

0.1.4 is in `cli/` and not published yet (`npm publish` from `cli/`). In it:

- `tokn scan` and `tokn dashboard` refresh prices from the site when the saved
  table is more than a day old, with a 3 second timeout, and work unlinked.
- `tokn sync` and autosync fetch prices again when the server reports
  `newlyPriced`, and say which models it priced.
- Refused rows print once per day and reason, and a whole refused day prints
  as "every model".
- Both spellings of a Claude model merge into one line in local reports.
- The bundled offline price snapshot is regenerated: 756 models from 25
  providers, from the catalog of 30 October 2026.

### Docs

`backend/README.md` covers the limits and `audit:usage`, model id grouping,
new-model pricing and the scripts, and warns not to run `seed:demo` against
production. `web/README.md` covers profile sections, looks, widths, customise
mode, logos and the CLI sync response. `pricing/README.md` covers the logos
pipeline, `normalizeModelId` and tests. `cli/README.md` covers the price
refresh, `newlyPriced` and `rejected`.
