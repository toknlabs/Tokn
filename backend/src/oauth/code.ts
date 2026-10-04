import crypto from "node:crypto";

/**
 * Authorization codes and PKCE.
 *
 * A code is **stateless and signed**: `toknac_` + base64url(JSON) + `.` +
 * base64url(HMAC-SHA256). Nothing is written when one is issued, so there is
 * no collection to provision and nothing to clean up — it lives for two
 * minutes and then the signature check refuses it on its own.
 *
 * What a signature cannot do is make a code single-use. That is enforced where
 * the code is spent: the device row it mints has an id derived from the code,
 * so a second redemption collides with the first (see `devices.ts`). That only
 * holds if each code has exactly one spelling, which is why the signature is
 * compared as the exact string it was issued as, never decoded first — base64
 * has more than one way to write the same bytes, and a second spelling would
 * be a second device id.
 */

export const CODE_PREFIX = "toknac_";

/** Long enough to finish a redirect, short enough that a leaked one is dead. */
export const CODE_TTL_MS = 120_000;

/** A code is a few hundred characters; anything much longer is not one. */
const MAX_CODE_LENGTH = 2048;

export interface CodeClaims {
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  /** Space-separated, in canonical order. */
  scope: string;
  /** Expiry, ms since the epoch. */
  exp: number;
  /** Makes two codes issued in the same millisecond still differ. */
  nonce: string;
}

function mac(data: string, key: Uint8Array): string {
  return crypto.createHmac("sha256", key).update(data).digest("base64url");
}

/** Constant-time string comparison that tolerates different lengths. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function signCode(
  claims: Omit<CodeClaims, "exp" | "nonce">,
  key: Uint8Array,
  now: number = Date.now(),
): string {
  const payload: CodeClaims = {
    ...claims,
    exp: now + CODE_TTL_MS,
    nonce: crypto.randomBytes(16).toString("base64url"),
  };
  const data = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${CODE_PREFIX}${data}.${mac(data, key)}`;
}

export type CodeCheck =
  | { ok: true; claims: CodeClaims }
  | { ok: false; reason: "malformed" | "signature" | "expired" };

export function verifyCode(code: unknown, key: Uint8Array, now: number = Date.now()): CodeCheck {
  if (typeof code !== "string" || code.length > MAX_CODE_LENGTH || !code.startsWith(CODE_PREFIX)) {
    return { ok: false, reason: "malformed" };
  }

  const parts = code.slice(CODE_PREFIX.length).split(".");
  if (parts.length !== 2) return { ok: false, reason: "malformed" };
  const [data, signature] = parts as [string, string];
  if (!/^[A-Za-z0-9_-]+$/.test(data) || !/^[A-Za-z0-9_-]+$/.test(signature)) {
    return { ok: false, reason: "malformed" };
  }

  // Before parsing anything: an unsigned payload is not worth reading.
  if (!safeEqual(signature, mac(data, key))) return { ok: false, reason: "signature" };

  let claims: CodeClaims;
  try {
    claims = JSON.parse(Buffer.from(data, "base64url").toString("utf8")) as CodeClaims;
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const strings = ["userId", "clientId", "redirectUri", "codeChallenge", "scope", "nonce"] as const;
  if (
    typeof claims !== "object" ||
    claims === null ||
    strings.some((field) => typeof claims[field] !== "string") ||
    typeof claims.exp !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }

  if (now >= claims.exp) return { ok: false, reason: "expired" };
  return { ok: true, claims };
}

/* ------------------------------------------------------------------ PKCE */

/** RFC 7636 §4.1: 43–128 characters of the unreserved set. */
const VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;

/** An S256 challenge is a SHA-256 in unpadded base64url: always 43 chars. */
const CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

export function isCodeVerifier(value: unknown): value is string {
  return typeof value === "string" && VERIFIER.test(value);
}

export function isCodeChallenge(value: unknown): value is string {
  return typeof value === "string" && CHALLENGE.test(value);
}

/** BASE64URL(SHA256(ASCII(verifier))), per RFC 7636 §4.2. */
export function pkceChallenge(verifier: string): string {
  return crypto.createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function pkceMatches(verifier: string, challenge: string): boolean {
  return isCodeVerifier(verifier) && safeEqual(pkceChallenge(verifier), challenge);
}

/* ------------------------------------------------------------ the key */

const HKDF_INFO = "tokn-oauth-code-v1";

/**
 * The HMAC key codes are signed with.
 *
 * `TOKN_OAUTH_SECRET` when it is set. Otherwise one is derived from the
 * Appwrite API key with HKDF, so a deployment that has never heard of OAuth
 * can issue codes with no new configuration. HKDF is one-way, so the codes
 * reveal nothing about the key they came from, and the `info` label keeps this
 * derivation from ever colliding with another use of the same secret.
 *
 * Rotating either secret invalidates codes in flight. They live two minutes,
 * so that costs at most one retried sign-in.
 */
export function oauthKey(env: Record<string, string | undefined> = process.env): Buffer {
  const explicit = env.TOKN_OAUTH_SECRET?.trim();
  if (explicit) return Buffer.from(explicit, "utf8");

  const apiKey = env.APPWRITE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("Neither TOKN_OAUTH_SECRET nor APPWRITE_API_KEY is set; cannot sign OAuth codes.");
  }

  return Buffer.from(crypto.hkdfSync("sha256", apiKey, Buffer.alloc(0), HKDF_INFO, 32));
}
