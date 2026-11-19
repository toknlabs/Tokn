import assert from "node:assert/strict";
import test from "node:test";
import { parseOwnerIds } from "../src/env.ts";
import { findOAuthClient } from "../src/oauth/clients.ts";
import { oauthDeviceId } from "../src/oauth/devices.ts";
import { appSignIns, lastSeen } from "../src/oauth/signins.ts";
import type { Device } from "../src/repo/devices.ts";
import type { Profile } from "../src/repo/profiles.ts";

/*
 * The owner page's view of "Sign in with tokn": device rows folded into one
 * row per person. No database: the rows are built the way the token endpoint
 * and a sync would leave them.
 */

const EAON = findOAuthClient("eaon-desktop")!;

let codes = 0;
function signIn(userId: string, fields: Partial<Device> = {}): Device {
  return {
    $id: oauthDeviceId(`code-${++codes}`, ["profile", "usage:write"]),
    userId,
    tokenHash: `hash-${codes}`,
    hostname: "ada.local",
    platform: "darwin",
    cliVersion: "eaon-desktop/2026.7.0",
    linkedAt: "2026-10-01T09:00:00.000+00:00",
    lastSyncAt: null,
    revokedAt: null,
    ...fields,
  };
}

function profile(id: string, handle: string, name?: string): Profile {
  return {
    $id: id,
    handle,
    handleLower: handle.toLowerCase(),
    name: name ?? null,
    passwordHash: "",
    billing: "api",
    isPublic: false,
    createdAt: "2026-09-01T00:00:00.000+00:00",
  };
}

const PROFILES = [profile("usr_ada", "ada", "Ada"), profile("usr_bob", "bob")];

test("one row per person, linked while any sign-in is live", () => {
  const rows = appSignIns(
    EAON,
    [
      signIn("usr_ada", { revokedAt: "2026-10-02T09:00:00.000+00:00" }),
      signIn("usr_ada", { hostname: "ada-mini", linkedAt: "2026-10-05T09:00:00.000+00:00" }),
    ],
    PROFILES,
  );

  assert.equal(rows.length, 1);
  const [ada] = rows;
  assert.equal(ada!.handle, "ada");
  assert.equal(ada!.name, "Ada");
  assert.equal(ada!.linked, true);
  assert.equal(ada!.unlinkedAt, null);
  assert.equal(ada!.firstLinkedAt, "2026-10-01T09:00:00.000+00:00");
  assert.equal(ada!.lastLinkedAt, "2026-10-05T09:00:00.000+00:00");
  // Only where they are linked now; the revoked sign-in's computer is not.
  assert.deepEqual(ada!.computers, ["ada-mini"]);
  assert.equal(ada!.signIns, 2);
});

test("everything revoked reads as unlinked, as of the last revoke", () => {
  const [bob] = appSignIns(
    EAON,
    [
      signIn("usr_bob", { revokedAt: "2026-10-03T09:00:00.000+00:00" }),
      signIn("usr_bob", { revokedAt: "2026-10-04T09:00:00.000+00:00" }),
    ],
    PROFILES,
  );

  assert.equal(bob!.linked, false);
  assert.equal(bob!.unlinkedAt, "2026-10-04T09:00:00.000+00:00");
  assert.deepEqual(bob!.computers, []);
  assert.equal(lastSeen(bob!), "2026-10-04T09:00:00.000+00:00");
});

test("the version is the one the last sync reported", () => {
  const [ada] = appSignIns(
    EAON,
    [
      signIn("usr_ada", { cliVersion: "eaon-desktop/2026.6.3", lastSyncAt: "2026-10-02T09:00:00.000+00:00" }),
      signIn("usr_ada", { cliVersion: "eaon-desktop/2026.7.0", lastSyncAt: "2026-10-09T09:00:00.000+00:00" }),
      signIn("usr_ada", { cliVersion: "eaon-desktop/2026.6.0", linkedAt: "2026-09-20T09:00:00.000+00:00" }),
    ],
    PROFILES,
  );

  assert.equal(ada!.version, "2026.7.0");
  assert.equal(ada!.lastSyncAt, "2026-10-09T09:00:00.000+00:00");
});

test("a CLI that reports the app's version string is not a sign-in", () => {
  const rows = appSignIns(
    EAON,
    [
      signIn("usr_bob", { $id: "dev_0123456789abcdef", cliVersion: "eaon-desktop/2026.7.0" }),
      signIn("usr_ada", { cliVersion: "0.9.2" }),
    ],
    PROFILES,
  );
  assert.deepEqual(rows, []);
});

test("an app that sent no computer name is not listed as a computer", () => {
  const [ada] = appSignIns(EAON, [signIn("usr_ada", { hostname: "Eaon Desktop" })], PROFILES);
  assert.deepEqual(ada!.computers, []);
});

test("most recently active first; a profile that is gone keeps its row", () => {
  const rows = appSignIns(
    EAON,
    [
      signIn("usr_ada", { lastSyncAt: "2026-10-03T09:00:00.000+00:00" }),
      signIn("usr_bob", { linkedAt: "2026-10-06T09:00:00.000+00:00" }),
      signIn("usr_gone", { linkedAt: "2026-10-02T09:00:00.000+00:00" }),
    ],
    PROFILES,
  );

  assert.deepEqual(
    rows.map((row) => row.handle),
    ["bob", "ada", null],
  );
});

test("owner ids: comma-separated, trimmed, and nobody when unset", () => {
  assert.deepEqual(parseOwnerIds(undefined), []);
  assert.deepEqual(parseOwnerIds(""), []);
  assert.deepEqual(parseOwnerIds(" usr_a , ,usr_b "), ["usr_a", "usr_b"]);
});
