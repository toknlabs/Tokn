"use client";

import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Sign in and create account share one form: the fields are identical, and a
 * switch is cheaper than a second page.
 */
export function AuthForm({
  next = "/account",
  afterSignup = "/welcome",
  github = false,
  initialError = null,
}: {
  /** Where to go after signing in, by any method. Already checked by the page. */
  next?: string;
  /** Where a newly created account goes. Also checked by the page. */
  afterSignup?: string;
  /** Whether GitHub sign-in is configured on this deployment. */
  github?: boolean;
  /** A message handed back by the OAuth callback after a failed attempt. */
  initialError?: string | null;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  /**
   * Whether to offer passkeys at all.
   *
   * Decided after mount rather than during render: the server cannot know what
   * the browser supports, and guessing produces a button that either flickers
   * away on hydration or sits there failing on a browser that has no
   * authenticator.
   */
  const [passkeys, setPasskeys] = useState(false);
  useEffect(() => setPasskeys(browserSupportsWebAuthn()), []);
  const [handle, setHandle] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(initialError);
  const [busy, setBusy] = useState(false);

  /**
   * Sign in with a passkey. No handle is typed: the options carry no credential
   * list, so the authenticator offers whichever of its keys belongs to this
   * site and the account is resolved from the one it returns.
   */
  /**
   * Leave for `path`, signed in.
   *
   * An app's sign-in (`/oauth/…`) is a route handler that answers with a real
   * redirect, sometimes all the way to the app's loopback on this machine, so
   * it gets a full navigation; the client router would fetch it as a page.
   * Everywhere else, the layout reads the session cookie server-side, so the
   * whole tree has to re-render: a plain push would keep showing "sign in".
   */
  function go(path: string) {
    if (path.startsWith("/oauth/")) {
      window.location.assign(path);
      return;
    }
    router.push(path);
    router.refresh();
  }

  async function withPasskey() {
    setBusy(true);
    setError(null);

    try {
      const optionsResponse = await fetch("/api/passkeys/auth/options", { method: "POST" });
      const options = await optionsResponse.json();
      if (!optionsResponse.ok) throw new Error(options.error ?? "could not start");

      const assertion = await startAuthentication({ optionsJSON: options });

      const verifyResponse = await fetch("/api/passkeys/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(assertion),
      });
      const verified = await verifyResponse.json();
      if (!verifyResponse.ok) throw new Error(verified.error ?? "that passkey did not work");

      go(next);
    } catch (problem) {
      const message = (problem as Error).message;
      // Cancelling the platform prompt is a choice, not a failure.
      setError(/abort|NotAllowed/i.test(message) ? null : message);
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, password }),
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "something went wrong");
        return;
      }

      go(mode === "signup" ? afterSignup : next);
    } catch {
      setError("could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ maxWidth: "23rem", margin: "3rem auto 0", width: "100%" }}>
      <h1 className="title">{mode === "login" ? "sign in" : "create an account"}</h1>
      <p className="lede" style={{ marginTop: "0.5rem", fontSize: "0.875rem" }}>
        your handle is what appears on the board. no email, no verification.
      </p>

      {/*
        Passkeys first. Someone returning with one wants the fastest way in,
        and putting it under the password fields made the quickest option the
        least visible thing on the page. Rendered only where the browser has
        an authenticator to offer.
      */}
      {mode === "login" && passkeys && (
        <button
          type="button"
          className="btn"
          onClick={withPasskey}
          disabled={busy}
          style={{
            marginTop: "1.75rem",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "0.55rem",
            width: "100%",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor"
               strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="5.6" cy="5.6" r="3.2" />
            <path d="M8 8 13.6 13.6" />
            <path d="M11.2 11.2 10 12.4" />
            <path d="M13.6 13.6 12.4 14.8" />
          </svg>
          use a passkey
        </button>
      )}

      {github && (
        <>
          <a
            className="btn"
            href={`/api/auth/github?next=${encodeURIComponent(next)}`}
            style={{
              marginTop: mode === "login" && passkeys ? "0.6rem" : "1.75rem",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "0.55rem",
              width: "100%",
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.4 7.4 0 0 1 2-.27c.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
            </svg>
            continue with github
          </a>

          <div
            className="micro"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.7rem",
              margin: "1.25rem 0 0.25rem",
            }}
          >
            <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
            or
            <span style={{ flex: 1, height: 1, background: "var(--line)" }} />
          </div>
        </>
      )}

      <form onSubmit={submit} style={{ display: "grid", gap: "0.9rem", marginTop: github ? "0.75rem" : "1.75rem" }}>
        <div className="field">
          <label htmlFor="handle">handle</label>
          <input
            id="handle"
            className="input"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="yourname"
            required
          />
        </div>

        <div className="field">
          <label htmlFor="password">password</label>
          <input
            id="password"
            className="input"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            placeholder={mode === "signup" ? "at least 8 characters" : ""}
            required
          />
        </div>

        {error && (
          <div className="notice" role="alert">
            {error}
          </div>
        )}

        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "…" : mode === "login" ? "sign in" : "create account"}
        </button>

      </form>

      <p className="micro" style={{ marginTop: "1.5rem", textAlign: "center" }}>
        {mode === "login" ? "new here? " : "already have one? "}
        <button
          type="button"
          className="btn bare"
          style={{ color: "var(--main)", padding: 0 }}
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setError(null);
          }}
        >
          {mode === "login" ? "create an account" : "sign in"}
        </button>
      </p>
    </div>
  );
}
