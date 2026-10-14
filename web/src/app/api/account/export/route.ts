import { currentUser } from "@/lib/auth";
import { listAgents, listDevices, listPasskeys, listUsage } from "@/lib/backend";
import { parseLinks } from "@/lib/links";
import { parsePlans } from "@/lib/plans";
import { parsePrefs } from "@/lib/prefs";

/**
 * GET /api/account/export?format=csv|json — everything this account holds.
 *
 * A service people upload their spending to should be able to hand it back.
 * Someone who cannot get their data out is right to hesitate before putting it
 * in, and "export" is the cheapest possible answer to that hesitation.
 *
 * ## What is deliberately not in here
 *
 * `passwordHash` from the profile, and `tokenHash` from every device. Both are
 * credential material: the token hash is what a CLI proves itself with, so a
 * leaked export would be a leaked set of device credentials. Exporting your own
 * secrets to a file in your Downloads folder is not a feature.
 *
 * Passkeys are reduced to metadata — a label and the dates. The public key and
 * credential id are not secret by construction, but nothing useful can be done
 * with them outside the authenticator that holds the private half, and they
 * make the file longer and more fingerprintable for no gain.
 *
 * ## Two formats, because they answer different questions
 *
 * CSV is the usage rows alone, which is what anyone actually wants to open in a
 * spreadsheet and check our arithmetic against their own. JSON is the complete
 * record: profile, usage, agent runs, devices, passkey metadata.
 */

export const dynamic = "force-dynamic";

/** RFC 4180: quote when the value could otherwise break the row. */
function csvCell(value: string | number | boolean): string {
  const text = String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const USAGE_COLUMNS = [
  "day",
  "tool",
  "model",
  "fast",
  "requests",
  "input",
  "output",
  "cacheWrite5m",
  "cacheWrite1h",
  "cacheRead",
  "costUsd",
] as const;

export async function GET(request: Request) {
  const user = await currentUser();
  if (!user) {
    return new Response(JSON.stringify({ error: "sign in first" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const format = new URL(request.url).searchParams.get("format") === "json" ? "json" : "csv";
  const stamp = new Date().toISOString().slice(0, 10);
  const usage = await listUsage(user.id);

  if (format === "csv") {
    const lines = [USAGE_COLUMNS.join(",")];
    for (const row of usage) {
      lines.push(USAGE_COLUMNS.map((column) => csvCell(row[column])).join(","));
    }
    // Sorted so a diff between two exports is readable rather than reordered.
    return new Response(lines.join("\n") + "\n", {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="tokn-${user.handle}-${stamp}.csv"`,
        "cache-control": "no-store",
      },
    });
  }

  const [devices, passkeys, agents] = await Promise.all([
    listDevices(user.id),
    listPasskeys(user.id),
    listAgents(user.id),
  ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    format: 1,
    profile: {
      handle: user.handle,
      name: user.name,
      bio: user.bio,
      createdAt: user.created_at,
      billing: user.billing,
      isPublic: user.isPublic,
      listed: user.listed,
      avatarUrl: user.avatarUrl,
      links: parseLinks(user.links),
      plans: parsePlans(user.plans),
      prefs: parsePrefs(user.prefs),
    },
    usage,
    // Agent runs per day, from apps that report them (Eaon Desktop).
    agents: agents.map((row) => ({
      day: row.day,
      tool: row.tool,
      runs: row.runs,
      totalMs: row.totalMs,
      longestMs: row.longestMs,
    })),
    devices: devices.map((device) => ({
      hostname: device.hostname ?? null,
      platform: device.platform ?? null,
      cliVersion: device.cliVersion ?? null,
      linkedAt: device.linkedAt,
      lastSyncAt: device.lastSyncAt ?? null,
      revokedAt: device.revokedAt ?? null,
    })),
    passkeys: passkeys.map((passkey) => ({
      label: passkey.label ?? null,
      createdAt: passkey.createdAt,
    })),
  };

  return new Response(JSON.stringify(payload, null, 2) + "\n", {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="tokn-${user.handle}-${stamp}.json"`,
      "cache-control": "no-store",
    },
  });
}
