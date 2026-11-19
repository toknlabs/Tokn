import { db, DB_ID, Query } from "./client.ts";
import { implausible, overDay, type Breach } from "./repo/integrity.ts";
import { clearUsageCache, listAllUsage, type UsageDoc } from "./repo/usage.ts";
import { refreshTotals } from "./repo/leaderboard.ts";
import { findProfileById } from "./repo/profiles.ts";

/**
 * Re-check stored usage against the integrity ceilings.
 *
 *   npm run audit:usage              report only
 *   npm run audit:usage -- --apply   delete what it flags, refresh totals
 *
 * `assess` stops a forged row at the door; this finds the ones that got in
 * before a ceiling existed. They do not wash out on their own. The CLI
 * re-uploads only the buckets it has, so a row written by hand under a bucket
 * the CLI never produces is never overwritten by a later sync.
 *
 * Only a row that breaks a ceiling by itself is deleted. A day that is over
 * only in sum is reported and left alone: nothing here can tell which of its
 * rows is the invented one, and deleting an honest row is worse than leaving a
 * total for a person to look at.
 *
 * Pricing and age are not rechecked. A model that has since lost its price,
 * or a row that has simply grown old, is still honest history.
 */

const apply = process.argv.includes("--apply");
const BATCH = 100;

interface Flag {
  row: UsageDoc;
  breach: Breach;
}

const rows = await listAllUsage();
const flagged: Flag[] = [];
const days = new Map<string, UsageDoc[]>();

for (const row of rows) {
  const breach = implausible(row) ?? overDay([row]);
  if (breach) {
    flagged.push({ row, breach });
    continue;
  }
  const key = `${row.userId}|${row.day}`;
  const day = days.get(key);
  if (day) day.push(row);
  else days.set(key, [row]);
}

const overInSum: { userId: string; day: string; breach: Breach }[] = [];
for (const [key, dayRows] of days) {
  const breach = overDay(dayRows);
  if (!breach) continue;
  const [userId, day] = key.split("|") as [string, string];
  overInSum.push({ userId, day, breach });
}

const handles = new Map<string, string>();
async function handleOf(userId: string): Promise<string> {
  if (!handles.has(userId)) {
    const profile = await findProfileById(userId);
    handles.set(userId, profile ? `@${profile.handle}` : `(no profile ${userId})`);
  }
  return handles.get(userId)!;
}

console.log(`Checked ${rows.length.toLocaleString()} rows.\n`);

if (flagged.length === 0) {
  console.log("No row breaks a ceiling on its own.");
} else {
  console.log(`${flagged.length} row(s) break a ceiling on their own${apply ? "" : " (not deleted: pass --apply)"}:`);
  for (const { row, breach } of flagged) {
    console.log(
      `  ${(await handleOf(row.userId)).padEnd(20)} ${row.day}  ${row.tool}  ${row.model}` +
        `  ${row.requests.toLocaleString()} req  ${row.output.toLocaleString()} out` +
        `  $${row.costUsd.toFixed(2)}  ${breach.reason}: ${breach.detail}`,
    );
  }
}

if (overInSum.length > 0) {
  console.log(`\n${overInSum.length} day(s) over a ceiling only in sum (left alone, look at these by hand):`);
  for (const { userId, day, breach } of overInSum) {
    console.log(`  ${(await handleOf(userId)).padEnd(20)} ${day}  ${breach.reason}: ${breach.detail}`);
  }
}

if (apply && flagged.length > 0) {
  const ids = flagged.map((f) => f.row.$id);
  for (let i = 0; i < ids.length; i += BATCH) {
    await db().deleteDocuments(DB_ID, "usage_daily", [Query.equal("$id", ids.slice(i, i + BATCH))]);
  }

  // The rollup is what the board reads, and refreshing it also stamps
  // `lastSyncAt`, which is what puts the user into the board's next hourly
  // delta. Without it the deleted spend would stay on the board.
  const owners = new Set(flagged.map((f) => f.row.userId));
  for (const userId of owners) {
    clearUsageCache(userId);
    if (await findProfileById(userId)) await refreshTotals(userId);
  }

  console.log(`\nDeleted ${ids.length} row(s); refreshed totals for ${owners.size} account(s).`);
  console.log("The board takes this in at the top of the next hour.");
}
