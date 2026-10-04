import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";
import { safeReturnPath } from "../src/return-path.ts";
import {
  OAUTH_CLIENTS,
  appWaitingAt,
  findOAuthClient,
  isLoopbackRedirect,
  resolveScopes,
} from "../src/oauth/clients.ts";
import {
  CODE_PREFIX,
  CODE_TTL_MS,
  isCodeVerifier,
  oauthKey,
  pkceChallenge,
  pkceMatches,
  signCode,
  verifyCode,
} from "../src/oauth/code.ts";
import {
  approveAuthorization,
  authorizePath,
  authorizeRequest,
  denyAuthorization,
  isSameOrigin,
  type AuthorizeOutcome,
} from "../src/oauth/authorize.ts";
import {
  authorizationServerMetadata,
  exchangeToken,
  revokeToken,
  type NewDevice,
  type OAuthStore,
  type OAuthUser,
} from "../src/oauth/token.ts";
import {
  deviceMayUpload,
  oauthAppForDevice,
  versionAfterSync,
} from "../src/oauth/devices.ts";
import { oauthParamsFromBody, oauthParamsFromRecord } from "../src/oauth/params.ts";

/*
 * Sign in with tokn, end to end, without a network or a database: the store is
 * an in-memory fake with the one property that matters — inserting a device id
 * that already exists fails, the way Appwrite's 409 does.
 */

const KEY = Buffer.alloc(32, 7);
const NOW = Date.parse("2026-10-03T12:00:00.000Z");
const PUBLIC_URL = "https://toknhq.com";
const REDIRECT = "http://127.0.0.1:53682/callback";

// RFC 7636 Appendix B.
const VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

const ADA: OAuthUser = { id: "usr_ada", handle: "ada", name: "Ada" };

function memoryStore(users: OAuthUser[] = [ADA]) {
  const devices = new Map<string, NewDevice & { revoked: boolean }>();
  const store: OAuthStore = {
    async findUser(userId) {
      return users.find((user) => user.id === userId) ?? null;
    },
    async createDevice(id, device) {
      if (devices.has(id)) return false;
      devices.set(id, { ...device, revoked: false });
      return true;
    },
    async revokeDevice(id) {
      const device = devices.get(id);
      if (device) device.revoked = true;
    },
    async revokeTokenHash(tokenHash) {
      for (const device of devices.values()) {
        if (device.tokenHash === tokenHash) device.revoked = true;
      }
    },
  };
  return { store, devices };
}

function authorizeParams(overrides: Record<string, string | null> = {}): URLSearchParams {
  const values: Record<string, string | null> = {
    response_type: "code",
    client_id: "eaon-desktop",
    redirect_uri: REDIRECT,
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "st-123",
    scope: "profile usage:write",
    ...overrides,
  };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== null) params.set(key, value);
  return params;
}

function consent(outcome: AuthorizeOutcome) {
  assert.equal(outcome.kind, "consent", JSON.stringify(outcome));
  return (outcome as Extract<AuthorizeOutcome, { kind: "consent" }>).request;
}

function issueCode(overrides: Record<string, string | null> = {}, now = NOW): string {
  const request = consent(authorizeRequest(authorizeParams(overrides)));
  const location = new URL(approveAuthorization(request, ADA.id, KEY, now));
  return location.searchParams.get("code")!;
}

function tokenParams(code: string, overrides: Record<string, string | null> = {}): URLSearchParams {
  const values: Record<string, string | null> = {
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT,
    client_id: "eaon-desktop",
    code_verifier: VERIFIER,
    device_name: "ada.local",
    platform: "darwin",
    app_version: "2026.6.0",
    ...overrides,
  };
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== null) params.set(key, value);
  return params;
}

/* ------------------------------------------------------------- codes */

test("a signed code verifies and carries its claims", () => {
  const code = signCode(
    { userId: "usr_ada", clientId: "eaon-desktop", redirectUri: REDIRECT, codeChallenge: CHALLENGE, scope: "profile" },
    KEY,
    NOW,
  );
  assert.ok(code.startsWith(CODE_PREFIX));

  const checked = verifyCode(code, KEY, NOW + 1000);
  assert.ok(checked.ok);
  assert.equal(checked.claims.userId, "usr_ada");
  assert.equal(checked.claims.redirectUri, REDIRECT);
  assert.equal(checked.claims.exp, NOW + CODE_TTL_MS);
});

test("two codes for the same request differ", () => {
  assert.notEqual(issueCode(), issueCode());
});

test("a tampered payload, a tampered signature or the wrong key is refused", () => {
  const code = issueCode();
  const [data, signature] = code.slice(CODE_PREFIX.length).split(".") as [string, string];

  // Rewrite the payload to claim another user, keeping the old signature.
  const claims = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  claims.userId = "usr_mallory";
  const forged = `${CODE_PREFIX}${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${signature}`;
  assert.deepEqual(verifyCode(forged, KEY, NOW), { ok: false, reason: "signature" });

  const flipped = signature[0] === "A" ? `B${signature.slice(1)}` : `A${signature.slice(1)}`;
  assert.deepEqual(verifyCode(`${CODE_PREFIX}${data}.${flipped}`, KEY, NOW), { ok: false, reason: "signature" });

  assert.deepEqual(verifyCode(code, Buffer.alloc(32, 8), NOW), { ok: false, reason: "signature" });
});

test("a second spelling of the same signature bytes is refused", () => {
  // The last base64url character of a 32-byte MAC carries two unused bits, so
  // several strings decode to identical bytes. Accepting more than one would
  // give one code two device ids, and so two redemptions.
  const code = issueCode();
  const [data, signature] = code.slice(CODE_PREFIX.length).split(".") as [string, string];
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const last = alphabet.indexOf(signature.at(-1)!);
  const twin = signature.slice(0, -1) + alphabet[last ^ 1];

  assert.ok(Buffer.from(twin, "base64url").equals(Buffer.from(signature, "base64url")));
  assert.equal(verifyCode(`${CODE_PREFIX}${data}.${twin}`, KEY, NOW).ok, false);
});

test("a code expires after two minutes", () => {
  const code = issueCode();
  assert.equal(verifyCode(code, KEY, NOW + CODE_TTL_MS - 1).ok, true);
  assert.deepEqual(verifyCode(code, KEY, NOW + CODE_TTL_MS), { ok: false, reason: "expired" });
});

test("anything that is not shaped like a code is malformed", () => {
  for (const value of [undefined, 42, "", "abc", `${CODE_PREFIX}nodot`, `${CODE_PREFIX}a.b.c`, `${CODE_PREFIX}a b.c`]) {
    assert.deepEqual(verifyCode(value, KEY, NOW), { ok: false, reason: "malformed" }, String(value));
  }
});

/* -------------------------------------------------------------- PKCE */

test("S256 matches the RFC 7636 test vector", () => {
  assert.equal(pkceChallenge(VERIFIER), CHALLENGE);
  assert.equal(pkceMatches(VERIFIER, CHALLENGE), true);
  assert.equal(pkceMatches(VERIFIER.replace("d", "e"), CHALLENGE), false);
});

test("a verifier is 43-128 characters of the unreserved set", () => {
  assert.equal(isCodeVerifier("a".repeat(43)), true);
  assert.equal(isCodeVerifier("a".repeat(128)), true);
  assert.equal(isCodeVerifier("A-._~z09".padEnd(43, "x")), true);
  assert.equal(isCodeVerifier("a".repeat(42)), false);
  assert.equal(isCodeVerifier("a".repeat(129)), false);
  for (const bad of ["+", "/", "=", " ", "é"]) {
    assert.equal(isCodeVerifier(bad.padEnd(43, "a")), false, bad);
  }
  assert.equal(isCodeVerifier(undefined), false);
});

/* ----------------------------------------------------- redirect URIs */

test("every loopback spelling is allowed on any unprivileged port", () => {
  for (const uri of [
    "http://127.0.0.1:1024/callback",
    "http://127.0.0.1:65535/callback",
    "http://localhost:8080/callback",
    "http://[::1]:53682/callback",
  ]) {
    assert.equal(isLoopbackRedirect(uri, "/callback"), true, uri);
  }
});

const BAD_REDIRECTS = [
  "http://127.0.0.1:1023/callback", // privileged port
  "http://127.0.0.1:65536/callback",
  "http://127.0.0.1:0/callback",
  "http://127.0.0.1:08080/callback", // leading zero
  "http://127.0.0.1/callback", // no port
  "http://127.0.0.1:8080/callback/",
  "http://127.0.0.1:8080/cb",
  "http://127.0.0.1:8080/",
  "http://127.0.0.1:8080",
  "http://127.0.0.1:8080/callback?x=1",
  "http://127.0.0.1:8080/callback#frag",
  "http://127.0.0.1:8080/callback?",
  "https://127.0.0.1:8080/callback",
  "https://toknhq.com/callback",
  "http://evil.com:8080/callback",
  "http://127.0.0.2:8080/callback",
  "http://127.1:8080/callback", // a parser reads this as 127.0.0.1
  "http://0x7f.0.0.1:8080/callback",
  "http://LOCALHOST:8080/callback",
  "http://localhost.:8080/callback",
  "http://[0:0:0:0:0:0:0:1]:8080/callback",
  "http://user:pass@127.0.0.1:8080/callback",
  "http://user@localhost:8080/callback",
  "http://127.0.0.1:8080@evil.com/callback",
  "http://127.0.0.1:8080\\@evil.com/callback",
  "http://127.0.0.1:8080/call\nback",
  " http://127.0.0.1:8080/callback",
  "http://127.0.0.1:8080/callback ",
  "HTTP://127.0.0.1:8080/callback",
  "//127.0.0.1:8080/callback",
  "javascript:alert(1)//127.0.0.1:8080/callback",
  "",
];

test("anything else is refused", () => {
  for (const uri of BAD_REDIRECTS) {
    assert.equal(isLoopbackRedirect(uri, "/callback"), false, JSON.stringify(uri));
  }
  assert.equal(isLoopbackRedirect(undefined, "/callback"), false);
  assert.equal(isLoopbackRedirect(null, "/callback"), false);
});

/* ------------------------------------------------------------ scopes */

test("scope defaults to the client's, refuses unknowns, and comes back canonical", () => {
  const client = findOAuthClient("eaon-desktop")!;
  assert.deepEqual(resolveScopes(client, null), { ok: true, scopes: ["profile", "usage:write"] });
  assert.deepEqual(resolveScopes(client, ""), { ok: true, scopes: ["profile", "usage:write"] });
  assert.deepEqual(resolveScopes(client, "usage:write profile"), { ok: true, scopes: ["profile", "usage:write"] });
  assert.deepEqual(resolveScopes(client, "profile profile"), { ok: true, scopes: ["profile"] });
  assert.deepEqual(resolveScopes(client, "profile admin"), { ok: false, unknown: "admin" });
  assert.deepEqual(resolveScopes(client, "PROFILE"), { ok: false, unknown: "PROFILE" });
});

/* --------------------------------------------------------- authorize */

test("a well-formed request asks for consent", () => {
  const request = consent(authorizeRequest(authorizeParams()));
  assert.equal(request.client.name, "Eaon Desktop");
  assert.equal(request.redirectUri, REDIRECT);
  assert.deepEqual(request.scopes, ["profile", "usage:write"]);
  assert.equal(request.state, "st-123");

  // Scope and state are optional.
  const bare = consent(authorizeRequest(authorizeParams({ scope: null, state: null })));
  assert.deepEqual(bare.scopes, ["profile", "usage:write"]);
  assert.equal(bare.state, null);
});

test("an unknown app, a missing client or a bad redirect is shown, never redirected", () => {
  // Every bad redirect, crossed with every other mistake a request can carry:
  // none of them may produce a redirect, whatever else is wrong.
  const otherMistakes: Record<string, string | null>[] = [
    {},
    { response_type: "token" },
    { response_type: null },
    { code_challenge_method: "plain" },
    { code_challenge_method: null },
    { code_challenge: null },
    { scope: "admin" },
  ];

  for (const redirect of [...BAD_REDIRECTS, null]) {
    for (const mistake of otherMistakes) {
      const outcome = authorizeRequest(authorizeParams({ ...mistake, redirect_uri: redirect }));
      assert.equal(outcome.kind, "invalid", `${redirect} ${JSON.stringify(mistake)}`);
    }
  }

  for (const clientId of ["nope", null, "EAON-DESKTOP"]) {
    for (const mistake of otherMistakes) {
      const outcome = authorizeRequest(authorizeParams({ ...mistake, client_id: clientId }));
      assert.equal(outcome.kind, "invalid", `${clientId} ${JSON.stringify(mistake)}`);
    }
  }

  // A repeated client_id or redirect_uri: which one would we trust?
  const twoRedirects = authorizeParams();
  twoRedirects.append("redirect_uri", "http://evil.com/callback");
  assert.equal(authorizeRequest(twoRedirects).kind, "invalid");

  const twoClients = authorizeParams();
  twoClients.append("client_id", "eaon-desktop");
  assert.equal(authorizeRequest(twoClients).kind, "invalid");
});

test("once the redirect is trusted, errors go back to it with the state", () => {
  const cases: [Record<string, string | null>, string][] = [
    [{ response_type: "token" }, "unsupported_response_type"],
    [{ response_type: null }, "invalid_request"],
    [{ code_challenge_method: "plain" }, "invalid_request"],
    [{ code_challenge_method: null }, "invalid_request"],
    [{ code_challenge: null }, "invalid_request"],
    [{ code_challenge: "too-short" }, "invalid_request"],
    [{ scope: "profile admin" }, "invalid_scope"],
  ];

  for (const [overrides, error] of cases) {
    const outcome = authorizeRequest(authorizeParams(overrides));
    assert.equal(outcome.kind, "redirect", JSON.stringify(overrides));
    const location = new URL((outcome as { location: string }).location);
    assert.equal(`${location.origin}${location.pathname}`, REDIRECT);
    assert.equal(location.searchParams.get("error"), error);
    assert.ok(location.searchParams.get("error_description"));
    assert.equal(location.searchParams.get("state"), "st-123");
  }

  // A repeated parameter after the redirect checks out is invalid_request.
  const repeated = authorizeParams();
  repeated.append("scope", "profile");
  const outcome = authorizeRequest(repeated);
  assert.equal(outcome.kind, "redirect");
  assert.equal(new URL((outcome as { location: string }).location).searchParams.get("error"), "invalid_request");
});

test("approve returns a code and the state; deny returns access_denied", () => {
  const request = consent(authorizeRequest(authorizeParams()));

  const approved = new URL(approveAuthorization(request, ADA.id, KEY, NOW));
  assert.equal(`${approved.origin}${approved.pathname}`, REDIRECT);
  assert.equal(approved.searchParams.get("state"), "st-123");
  const checked = verifyCode(approved.searchParams.get("code"), KEY, NOW);
  assert.ok(checked.ok);
  assert.equal(checked.claims.scope, "profile usage:write");

  const denied = new URL(denyAuthorization(request));
  assert.equal(`${denied.origin}${denied.pathname}`, REDIRECT);
  assert.equal(denied.searchParams.get("error"), "access_denied");
  assert.equal(denied.searchParams.get("state"), "st-123");
  assert.equal(denied.searchParams.get("code"), null);
});

test("the return path after sign-in keeps only the authorize parameters", () => {
  const params = authorizeParams();
  params.set("decision", "approve");
  params.set("next", "//evil.com");
  const path = authorizePath(params);
  assert.ok(path.startsWith("/oauth/authorize?"));
  assert.equal(safeReturnPath(path), path);
  const kept = new URLSearchParams(path.split("?")[1]);
  assert.equal(kept.get("decision"), null);
  assert.equal(kept.get("next"), null);
  assert.equal(kept.get("redirect_uri"), REDIRECT);
});

test("the consent form is accepted only from our own origin", () => {
  const allowed = ["https://toknhq.com", "http://localhost:3000/oauth/authorize"];
  assert.equal(isSameOrigin("https://toknhq.com", allowed), true);
  assert.equal(isSameOrigin("http://localhost:3000", allowed), true);
  assert.equal(isSameOrigin("https://evil.com", allowed), false);
  assert.equal(isSameOrigin("https://toknhq.com.evil.com", allowed), false);
  assert.equal(isSameOrigin("http://toknhq.com", allowed), false);
  assert.equal(isSameOrigin("null", allowed), false);
  assert.equal(isSameOrigin(null, allowed), false);
});

/* ------------------------------------------------------------- token */

test("a code is exchanged for a device token, recorded as the app", async () => {
  const { store, devices } = memoryStore();
  const reply = await exchangeToken(tokenParams(issueCode()), { store, key: KEY, publicUrl: PUBLIC_URL, now: NOW });

  assert.equal(reply.status, 200, JSON.stringify(reply.body));
  const body = reply.body as Record<string, unknown>;
  assert.match(String(body.access_token), /^tokn_[0-9a-f]{48}$/);
  assert.equal(body.token_type, "Bearer");
  assert.equal(body.scope, "profile usage:write");
  assert.deepEqual(body.user, { id: "usr_ada", handle: "ada", name: "Ada" });
  assert.equal(body.profile_url, "https://toknhq.com/profile/ada");

  assert.equal(devices.size, 1);
  const [id, device] = [...devices.entries()][0]!;
  assert.match(id, /^oa[0-9a-f]{34}$/);
  assert.equal(device.userId, "usr_ada");
  assert.equal(device.tokenHash, crypto.createHash("sha256").update(String(body.access_token)).digest("hex"));
  assert.equal(device.hostname, "ada.local");
  assert.equal(device.platform, "darwin");
  assert.equal(device.cliVersion, "eaon-desktop/2026.6.0");
  assert.equal(deviceMayUpload(id), true);

  const app = oauthAppForDevice(id, device.cliVersion);
  assert.equal(app?.client.name, "Eaon Desktop");
  assert.equal(app?.version, "2026.6.0");
});

test("a code is single use, and replaying it revokes what it bought", async () => {
  const { store, devices } = memoryStore();
  const code = issueCode();
  const deps = { store, key: KEY, publicUrl: PUBLIC_URL, now: NOW };

  assert.equal((await exchangeToken(tokenParams(code), deps)).status, 200);
  const second = await exchangeToken(tokenParams(code), deps);
  assert.equal(second.status, 400);
  assert.equal(second.body.error, "invalid_grant");

  assert.equal(devices.size, 1);
  assert.equal([...devices.values()][0]!.revoked, true);
});

test("the exchange checks client, redirect, verifier and expiry", async () => {
  const deps = () => ({ store: memoryStore().store, key: KEY, publicUrl: PUBLIC_URL, now: NOW });
  const code = issueCode();

  const cases: [URLSearchParams, number, string][] = [
    [tokenParams(code, { code_verifier: "x".repeat(43) }), 400, "invalid_grant"],
    [tokenParams(code, { redirect_uri: "http://127.0.0.1:53683/callback" }), 400, "invalid_grant"],
    [tokenParams(code, { redirect_uri: "http://localhost:53682/callback" }), 400, "invalid_grant"],
    [tokenParams(code, { client_id: "someone-else" }), 401, "invalid_client"],
    [tokenParams(code, { client_id: null }), 401, "invalid_client"],
    [tokenParams(code, { grant_type: "refresh_token" }), 400, "unsupported_grant_type"],
    [tokenParams(code, { grant_type: null }), 400, "invalid_request"],
    [tokenParams(code, { code: null }), 400, "invalid_request"],
    [tokenParams(code, { redirect_uri: null }), 400, "invalid_request"],
    [tokenParams(code, { code_verifier: null }), 400, "invalid_request"],
    [tokenParams(code, { code_verifier: "short" }), 400, "invalid_request"],
    [tokenParams(code, { code_verifier: `${"a".repeat(42)}+` }), 400, "invalid_request"],
    [tokenParams(`${code}x`), 400, "invalid_grant"],
    [tokenParams("toknac_garbage"), 400, "invalid_grant"],
  ];

  for (const [params, status, error] of cases) {
    const reply = await exchangeToken(params, deps());
    assert.equal(reply.status, status, `${params} → ${JSON.stringify(reply.body)}`);
    assert.equal(reply.body.error, error, params.toString());
    assert.ok(reply.body.error_description);
  }

  const late = await exchangeToken(tokenParams(code), { ...deps(), now: NOW + CODE_TTL_MS });
  assert.equal(late.body.error, "invalid_grant");

  const repeated = tokenParams(code);
  repeated.append("code", code);
  assert.equal((await exchangeToken(repeated, deps())).body.error, "invalid_request");

  assert.equal((await exchangeToken(null, deps())).body.error, "invalid_request");
});

test("a code issued to another client is refused", async () => {
  const foreign = signCode(
    { userId: "usr_ada", clientId: "other-app", redirectUri: REDIRECT, codeChallenge: CHALLENGE, scope: "profile" },
    KEY,
    NOW,
  );
  const reply = await exchangeToken(tokenParams(foreign), {
    store: memoryStore().store,
    key: KEY,
    publicUrl: PUBLIC_URL,
    now: NOW,
  });
  assert.equal(reply.body.error, "invalid_grant");
});

test("an account deleted in the meantime gets no token", async () => {
  const reply = await exchangeToken(tokenParams(issueCode()), {
    store: memoryStore([]).store,
    key: KEY,
    publicUrl: PUBLIC_URL,
    now: NOW,
  });
  assert.equal(reply.body.error, "invalid_grant");
});

test("a profile-only grant cannot upload, and the app name stands in for a missing hostname", async () => {
  const { store, devices } = memoryStore();
  const code = issueCode({ scope: "profile" });
  const reply = await exchangeToken(tokenParams(code, { device_name: null, platform: null, app_version: null }), {
    store,
    key: KEY,
    publicUrl: PUBLIC_URL,
    now: NOW,
  });

  assert.equal(reply.status, 200);
  assert.equal(reply.body.scope, "profile");
  const [id, device] = [...devices.entries()][0]!;
  assert.match(id, /^op[0-9a-f]{34}$/);
  assert.equal(deviceMayUpload(id), false);
  assert.equal(device.hostname, "Eaon Desktop");
  assert.equal(device.platform, null);
  assert.equal(device.cliVersion, "eaon-desktop");
});

test("device fields are cleaned and clipped to their columns", async () => {
  const { store, devices } = memoryStore();
  await exchangeToken(
    tokenParams(issueCode(), {
      device_name: `  ada\u0000\n.local${"x".repeat(200)}`,
      platform: "p".repeat(50),
      app_version: "2026.6.0-beta.1+build.77777777777777",
    }),
    { store, key: KEY, publicUrl: PUBLIC_URL, now: NOW },
  );
  const device = [...devices.values()][0]!;
  assert.ok(device.hostname.startsWith("ada.local"));
  assert.equal(device.hostname.length, 128);
  assert.equal(device.platform?.length, 32);
  assert.ok(device.cliVersion.startsWith("eaon-desktop/2026.6.0-beta"));
  assert.ok(device.cliVersion.length <= 32);
});

test("form and JSON bodies read the same", async () => {
  const code = issueCode();
  const form = oauthParamsFromBody(
    "application/x-www-form-urlencoded; charset=utf-8",
    tokenParams(code).toString(),
  );
  const json = oauthParamsFromBody(
    "application/json",
    JSON.stringify(Object.fromEntries(tokenParams(code))),
  );
  assert.equal(form?.get("code"), code);
  assert.equal(json?.get("code"), code);
  assert.equal(json?.get("redirect_uri"), REDIRECT);

  assert.equal(oauthParamsFromBody("application/json", "{not json"), null);
  assert.equal(oauthParamsFromBody("application/json", "[1,2]"), null);
  // Non-string JSON values are dropped, so they read as missing.
  assert.equal(oauthParamsFromBody("application/json", '{"code": 5}')?.get("code"), null);

  const record = oauthParamsFromRecord({ client_id: "eaon-desktop", scope: ["a", "b"], state: undefined });
  assert.deepEqual(record.getAll("scope"), ["a", "b"]);
  assert.equal(record.has("state"), false);
});

/* ------------------------------------------------------------ revoke */

test("revoke kills the matching token and answers 200 whatever it was sent", async () => {
  const { store, devices } = memoryStore();
  const reply = await exchangeToken(tokenParams(issueCode()), { store, key: KEY, publicUrl: PUBLIC_URL, now: NOW });
  const token = String(reply.body.access_token);

  assert.equal((await revokeToken(new URLSearchParams({ token: "tokn_nope" }), store)).status, 200);
  assert.equal([...devices.values()][0]!.revoked, false);

  assert.equal((await revokeToken(new URLSearchParams({ token }), store)).status, 200);
  assert.equal([...devices.values()][0]!.revoked, true);

  assert.equal((await revokeToken(new URLSearchParams(), store)).status, 200);
  assert.equal((await revokeToken(null, store)).status, 200);
});

/* ----------------------------------------------------------- devices */

test("an app keeps its name across syncs; a CLI's version is stored as sent", () => {
  const app = { $id: `oa${"0".repeat(34)}`, cliVersion: "eaon-desktop/2026.6.0" };
  assert.equal(versionAfterSync(app, "2026.7.0"), "eaon-desktop/2026.7.0");
  assert.equal(versionAfterSync(app, "eaon-desktop/2026.7.0"), "eaon-desktop/2026.7.0");
  assert.equal(versionAfterSync(app, undefined), undefined);

  const cli = { $id: "dev0123456789abcdef", cliVersion: "0.1.4" };
  assert.equal(versionAfterSync(cli, "0.1.5"), "0.1.5");

  // The prefix alone does not make a CLI device an app.
  assert.equal(oauthAppForDevice("dev0123456789abcdef", "eaon-desktop/1.0"), null);
  assert.equal(oauthAppForDevice(`oa${"0".repeat(34)}`, "unknown-app/1.0"), null);
  assert.equal(deviceMayUpload("dev0123456789abcdef"), true);
  assert.equal(deviceMayUpload("operator"), true);
});

/* --------------------------------------------------------- the key */

test("the signing key is the explicit secret, or HKDF of the Appwrite key", () => {
  assert.deepEqual(oauthKey({ TOKN_OAUTH_SECRET: "s3cret", APPWRITE_API_KEY: "k" }), Buffer.from("s3cret"));

  const derived = oauthKey({ APPWRITE_API_KEY: "standard_abc" });
  assert.equal(derived.length, 32);
  assert.deepEqual(
    derived,
    Buffer.from(crypto.hkdfSync("sha256", "standard_abc", Buffer.alloc(0), "tokn-oauth-code-v1", 32)),
  );
  assert.notDeepEqual(derived, oauthKey({ APPWRITE_API_KEY: "standard_abd" }));
  assert.throws(() => oauthKey({}));
});

/* ---------------------------------------------------------- metadata */

test("RFC 8414 metadata names every endpoint under the issuer", () => {
  const meta = authorizationServerMetadata("https://toknhq.com/");
  assert.equal(meta.issuer, "https://toknhq.com");
  assert.equal(meta.authorization_endpoint, "https://toknhq.com/oauth/authorize");
  assert.equal(meta.token_endpoint, "https://toknhq.com/api/oauth/token");
  assert.equal(meta.revocation_endpoint, "https://toknhq.com/api/oauth/revoke");
  assert.deepEqual(meta.response_types_supported, ["code"]);
  assert.deepEqual(meta.grant_types_supported, ["authorization_code"]);
  assert.deepEqual(meta.code_challenge_methods_supported, ["S256"]);
  assert.deepEqual(meta.token_endpoint_auth_methods_supported, ["none"]);
  assert.deepEqual(meta.scopes_supported, ["profile", "usage:write"]);
});

/* ------------------------------------------------------- return path */

test("only same-site paths survive as a return address", () => {
  assert.equal(safeReturnPath("/account"), "/account");
  assert.equal(safeReturnPath("/account/settings?tab=1#x"), "/account/settings?tab=1#x");
  assert.equal(safeReturnPath("/%2F%2Fevil.com"), "/%2F%2Fevil.com");
  assert.equal(safeReturnPath("/a/../link"), "/link");

  for (const bad of [
    "//evil.com",
    "/\\evil.com",
    "/\\/evil.com",
    "/\t/evil.com",
    "/\n/evil.com",
    "/.//evil.com",
    "/a/..//evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "evil.com",
    "",
    `/${"a".repeat(3000)}`,
    undefined,
    null,
    ["/account"],
  ]) {
    assert.equal(safeReturnPath(bad), null, JSON.stringify(bad));
  }
});

/* ------------------------------------------------ the welcome flow's app */

test("the welcome flow knows which app a new account was signing in to", () => {
  const authorize =
    "/oauth/authorize?response_type=code&client_id=eaon-desktop&redirect_uri=http%3A%2F%2F127.0.0.1%3A60802%2Fcallback";
  assert.equal(appWaitingAt(authorize)?.name, "Eaon Desktop");
  assert.equal(appWaitingAt(authorize)?.icon, "/apps/eaon-desktop.png");
  // Not an app's sign-in, or an app tokn does not know: no app is named.
  assert.equal(appWaitingAt("/account"), null);
  assert.equal(appWaitingAt("/oauth/consent?client_id=eaon-desktop"), null);
  assert.equal(appWaitingAt("/oauth/authorize?client_id=someone-else"), null);
  assert.equal(appWaitingAt(null), null);
  assert.equal(appWaitingAt(""), null);
});

test("every client has a name and an icon for the screens that show it", () => {
  for (const client of OAUTH_CLIENTS) {
    assert.ok(client.name.length > 0);
    assert.match(client.icon, /^\/apps\/[a-z0-9-]+\.png$/);
  }
});
