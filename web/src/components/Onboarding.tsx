"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { browserSupportsWebAuthn, startRegistration } from "@simplewebauthn/browser";
import { Avatar } from "@/components/Avatar";
import { SETUP_SEEN_COOKIE, SETUP_SEEN_MAX_AGE } from "@/lib/onboarding";
import { AVATAR_STYLES, type AvatarStyle } from "@/lib/prefs";
import { Terminal } from "@/components/Terminal";
import {
  ArtWelcome,
  ArtInstall,
  ArtLink,
  ArtLinked,
  ArtSecure,
  ArtDone,
} from "@/components/OnboardingArt";

/**
 * What a new account sees once, immediately after signing up.
 *
 * The order follows what the reader can actually do: say who they are, install
 * the CLI, link a machine, optionally add a passkey, then look at the thing
 * they came for. Identity comes first because it needs nothing but this page —
 * everything after it needs a terminal.
 *
 * Three decisions worth keeping:
 *
 * The link step has no "next" button. It polls, and advances by itself the
 * moment the machine connects. A button there would ask the reader to tell us
 * something we already know, and it is the one step where they must leave the
 * page — so when they come back, it should already have moved on.
 *
 * Skipping the CLI skips *the CLI*, not the flow. Install and connect are one
 * unit of work that needs a terminal, and someone who is not sitting at one
 * still has a passkey worth adding. Leaving entirely stays possible, but it is
 * a separate and quieter control.
 *
 * Every step can be left. A tutorial that traps someone is worse than none.
 *
 * When the account was made in the middle of an app's sign-in (`returnTo` is
 * that app's `/oauth/authorize`), the flow names the app, and every way out of
 * it — finishing, or skipping — goes back there to approve it.
 *
 * Motion: each step's content comes in as a short stagger and the
 * illustration cross-fades, keyed on the step so it replays; the rail fills as
 * the steps are done; a machine connecting gets a moment of its own before the
 * flow moves on. All of it stands still under prefers-reduced-motion.
 */

type Step = "welcome" | "profile" | "install" | "link" | "secure" | "done";

/**
 * The progress dots. "welcome" is deliberately absent: it is a greeting, not a
 * task, and numbering it would tell the reader they have six things to do when
 * they have five.
 */
const STEPS: { key: Step; label: string }[] = [
  { key: "profile", label: "profile" },
  { key: "install", label: "install" },
  { key: "link", label: "connect" },
  { key: "secure", label: "secure" },
  { key: "done", label: "done" },
];

const MAX_NAME = 60;

/** How long a link code lives (`CODE_TTL_MINUTES` in backend/src/repo/devices.ts), for the expiry bar. */
const CODE_TTL_MS = 10 * 60_000;

/** How long "connected" stays on screen before the flow moves on. */
const LINKED_PAUSE_MS = 1400;

const reducedMotion = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function Onboarding({
  handle: initialHandle,
  initialName,
  initialAvatar,
  avatarUrl,
  handleChangesLeft,
  initialCode,
  initialExpiry,
  alreadyLinked,
  hasPasskey,
  returnTo = null,
  app = null,
}: {
  handle: string;
  initialName: string | null;
  initialAvatar: AvatarStyle;
  avatarUrl: string | null;
  /** How many handle changes the account has left, for an honest warning. */
  handleChangesLeft: number;
  initialCode: string;
  initialExpiry: string;
  /** True when a machine connected before they reached this page. */
  alreadyLinked: boolean;
  hasPasskey: boolean;
  /** Where the account was headed when it signed up. Already checked by the page. */
  returnTo?: string | null;
  /** The app waiting at `returnTo`, when it is an app's sign-in. */
  app?: { name: string; icon: string } | null;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [code, setCode] = useState(initialCode);
  const [expiresAt, setExpiresAt] = useState(initialExpiry);
  const [linked, setLinked] = useState(alreadyLinked);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [passkeyAdded, setPasskeyAdded] = useState(hasPasskey);
  /** The machine just connected: "connected" holds the screen for a moment. */
  const [justLinked, setJustLinked] = useState(false);

  const index = STEPS.findIndex((s) => s.key === step);
  /** Where "later" and the last step lead. */
  const leave = returnTo ?? "/account";

  // Mark the browser the moment the flow opens, not when it is completed.
  // Someone who is shown this and closes the tab has been offered it, and
  // re-offering it on their next visit to their own account would be nagging.
  // Written from the client because a Server Component cannot set a cookie.
  useEffect(() => {
    document.cookie = `${SETUP_SEEN_COOKIE}=1; path=/; max-age=${SETUP_SEEN_MAX_AGE}; samesite=lax`;
  }, []);

  /* ----------------------------------------------------------- identity */

  const [handle, setHandle] = useState(initialHandle);
  const [name, setName] = useState(initialName ?? "");
  const [avatar, setAvatar] = useState<AvatarStyle>(initialAvatar);

  /** Where the flow goes once identity is settled. */
  const afterProfile = useCallback(
    () => setStep(linked ? "secure" : "install"),
    [linked],
  );

  async function saveIdentity() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/onboarding/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ handle, name, avatar }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "that did not save");
      setHandle(result.handle);
      router.refresh();
      afterProfile();
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /* ----------------------------------------------------------- linking */

  /**
   * The live code, read by the poller.
   *
   * Held in a ref so the polling effect below never lists `code` as a
   * dependency. If it did, issuing a fresh code would tear the interval down
   * and rebuild it mid-flight; the ref lets one long-lived timer always read
   * the current value instead.
   */
  const codeRef = useRef(code);
  codeRef.current = code;

  /** Guards against two refreshes racing when a poll overlaps a click. */
  const refreshing = useRef(false);
  const [remaining, setRemaining] = useState<number | null>(null);

  const refreshCode = useCallback(async () => {
    if (refreshing.current) return;
    refreshing.current = true;
    try {
      const response = await fetch("/api/link/code", { method: "POST" });
      if (!response.ok) throw new Error("could not issue a new code");
      const fresh = (await response.json()) as { code: string; expiresAt: string };
      setCode(fresh.code);
      setExpiresAt(fresh.expiresAt);
      setError(null);
    } catch (problem) {
      setError((problem as Error).message);
    } finally {
      refreshing.current = false;
    }
  }, []);

  // The countdown starts as null and is filled on the first client frame:
  // `Date.now()` differs between the server render and hydration, and rendering
  // it directly is a mismatch.
  useEffect(() => {
    if (step !== "link") return;
    const tick = () => setRemaining(Math.max(0, new Date(expiresAt).getTime() - Date.now()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [step, expiresAt]);

  useEffect(() => {
    if (step !== "link" || linked) return;

    // Poll on an interval that does not depend on any state this effect also
    // sets — an earlier version of this pattern elsewhere in the app tore the
    // timer down on every tick and never fired.
    let alive = true;
    const check = async () => {
      try {
        // Both halves of this call were wrong before and failed silently. The
        // endpoint needs the code it is being asked about, and it answers with
        // a `status` string — not the `linked`/`expired` booleans this once
        // read, which were always undefined. The effect was that the panel
        // never advanced on connect and never replaced an expired code, so a
        // code that timed out stayed on screen as a dead number forever.
        const response = await fetch(
          `/api/link/status?code=${encodeURIComponent(codeRef.current)}`,
          { cache: "no-store" },
        );
        if (!response.ok || !alive) return;
        const data = (await response.json()) as {
          status: "pending" | "linked" | "expired";
        };
        if (!alive) return;

        if (data.status === "linked") {
          setLinked(true);
          setJustLinked(true);
          router.refresh();
          window.setTimeout(
            () => {
              setJustLinked(false);
              setStep("secure");
            },
            reducedMotion() ? 500 : LINKED_PAUSE_MS,
          );
        } else if (data.status === "expired") {
          await refreshCode();
        }
      } catch {
        // A dropped poll is not worth showing anyone; the next one will do.
      }
    };
    void check();
    const timer = setInterval(check, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [step, linked, router, refreshCode]);

  /* ---------------------------------------------------------- passkeys */

  const [canPasskey, setCanPasskey] = useState(false);
  useEffect(() => setCanPasskey(browserSupportsWebAuthn()), []);

  async function addPasskey() {
    setBusy(true);
    setError(null);
    try {
      const optionsResponse = await fetch("/api/passkeys/register/options", { method: "POST" });
      const options = await optionsResponse.json();
      if (!optionsResponse.ok) throw new Error(options.error ?? "could not start");

      const attestation = await startRegistration({ optionsJSON: options });

      const verifyResponse = await fetch("/api/passkeys/register/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(attestation),
      });
      const verified = await verifyResponse.json();
      if (!verifyResponse.ok) throw new Error(verified.error ?? "that did not work");

      setPasskeyAdded(true);
      setStep("done");
    } catch (problem) {
      const message = (problem as Error).message;
      // Dismissing the platform prompt is a decision, not an error.
      setError(/abort|NotAllowed/i.test(message) ? null : message);
    } finally {
      setBusy(false);
    }
  }

  /* ------------------------------------------------------------ render */

  return (
    <div style={{ maxWidth: "34rem", margin: "2.5rem auto 0", width: "100%" }}>
      {step !== "welcome" && (
        <div className="onboard-rail">
          <ol className="onboard-steps" aria-label="setup progress">
            {STEPS.map((s, i) => {
              const state = i < index ? "done" : i === index ? "now" : "todo";
              return (
                // Keyed on the state too, so a dot's change of state replays its animation.
                <li key={`${s.key}-${state}`} data-state={state} aria-current={state === "now" ? "step" : undefined}>
                  <span className="dot" aria-hidden="true">
                    {state === "done" && (
                      <svg viewBox="0 0 12 12" width="12" height="12">
                        <path d="M3 6.2 5.1 8.3 9 4" />
                      </svg>
                    )}
                  </span>
                  {s.label}
                </li>
              );
            })}
          </ol>
          <div className="onboard-progress" aria-hidden="true">
            <span style={{ transform: `scaleX(${Math.max(0, index) / (STEPS.length - 1)})` }} />
          </div>
        </div>
      )}

      <div className="onboard-art">
        {/* Keyed on what it shows, so each illustration fades in fresh. */}
        <div className="onboard-art-inner" key={justLinked ? "linked" : step}>
          {step === "welcome" && <ArtWelcome />}
          {step === "profile" && (
            <ProfilePreview handle={handle} name={name} avatar={avatar} avatarUrl={avatarUrl} />
          )}
          {step === "install" && <ArtInstall />}
          {step === "link" && (justLinked ? <ArtLinked /> : <ArtLink />)}
          {step === "secure" && <ArtSecure />}
          {step === "done" && <ArtDone />}
        </div>
      </div>

      {step === "welcome" && (
        <section className="onboard-stage" key="welcome">
          <h1 className="title">welcome to tokn</h1>
          <p className="lede" style={{ marginTop: "0.5rem", fontSize: "0.9rem" }}>
            it reads what your AI coding tools already write to disk and turns it
            into a picture of what you actually spend. setting up takes about two
            minutes.
          </p>
          {app && (
            <div className="onboard-app">
              <img src={app.icon} alt="" width={28} height={28} />
              <span>
                <strong>{app.name}</strong> is waiting to connect. set up first, then
                you will approve it and head straight back.
              </span>
              <span className="beacon" aria-hidden="true" />
            </div>
          )}
          <div className="onboard-actions">
            <button type="button" className="btn primary" onClick={() => setStep("profile")}>
              get started
            </button>
            {/* A full navigation: an app's sign-in is a route that redirects. */}
            <a href={leave} className="micro link">
              {app ? `skip setup and connect ${app.name}` : "I will do this later"}
            </a>
          </div>
        </section>
      )}

      {step === "profile" && (
        <section className="onboard-stage" key="profile">
          <h1 className="title">who are you</h1>
          <p className="lede" style={{ marginTop: "0.5rem", fontSize: "0.9rem" }}>
            your handle is how people find you. the display name is what appears
            beside it. both can be changed later.
          </p>

          <div className="onboard-identity">
            <div className="onboard-avatar">
              <Avatar handle={handle || initialHandle} size={72} style={avatar} url={avatarUrl} />
              <div className="onboard-avatar-picks" role="group" aria-label="avatar style">
                {AVATAR_STYLES.map((option) => {
                  // "github" has nothing to draw without an avatar from GitHub.
                  const unavailable = option === "github" && !avatarUrl;
                  return (
                    <button
                      key={option}
                      type="button"
                      className="btn bare"
                      aria-pressed={option === avatar}
                      data-on={option === avatar ? "" : undefined}
                      disabled={unavailable}
                      title={unavailable ? "no github avatar on this account" : undefined}
                      onClick={() => setAvatar(option)}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="onboard-fields">
              <div className="field">
                <label htmlFor="onboard-handle">handle</label>
                <input
                  id="onboard-handle"
                  className="input"
                  value={handle}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(event) => setHandle(event.target.value)}
                />
              </div>

              <div className="field">
                <label htmlFor="onboard-name">display name</label>
                <input
                  id="onboard-name"
                  className="input"
                  value={name}
                  maxLength={MAX_NAME}
                  placeholder="optional"
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            </div>
          </div>

          {handle !== initialHandle && (
            <p className="micro" style={{ marginTop: "0.75rem" }}>
              changing your handle uses one of your {handleChangesLeft} remaining
              changes.
            </p>
          )}

          {error && (
            <p className="micro" style={{ marginTop: "0.75rem", color: "var(--error)" }}>
              {error}
            </p>
          )}

          <div className="onboard-actions">
            <button
              type="button"
              className="btn primary"
              onClick={saveIdentity}
              disabled={busy || !handle.trim()}
            >
              {busy ? "…" : "continue"}
            </button>
            <button type="button" className="btn" onClick={afterProfile} disabled={busy}>
              keep what I have
            </button>
          </div>
        </section>
      )}

      {step === "install" && (
        <section className="onboard-stage" key="install">
          <h1 className="title">install the cli</h1>
          <p className="lede" style={{ marginTop: "0.5rem", fontSize: "0.9rem" }}>
            it reads the session logs your AI tools already write to disk. nothing is
            uploaded until you link an account.
          </p>
          <div style={{ marginTop: "1.5rem" }}>
            <Terminal commands={["npm install -g toknhq"]} />
          </div>
          <p className="micro" style={{ marginTop: "1rem" }}>
            needs node 22.5 or newer. the command it installs is{" "}
            <span className="kbd">tokn</span>.
            {app &&
              ` ${app.name} reports its own usage; the cli adds Claude Code, Codex, Copilot CLI and opencode on this machine.`}
          </p>
          <div className="onboard-actions">
            <button type="button" className="btn primary" onClick={() => setStep("link")}>
              next
            </button>
            {/* Skips the CLI, not the flow: install and connect are one unit of
                work that needs a terminal, and a passkey is still worth having
                to someone who is not sitting at one. */}
            <button type="button" className="btn" onClick={() => setStep("secure")}>
              not at a terminal
            </button>
          </div>
        </section>
      )}

      {step === "link" && justLinked && (
        <section className="onboard-stage" key="linked" aria-live="polite">
          <h1 className="title">connected</h1>
          <p className="lede" style={{ marginTop: "0.5rem", fontSize: "0.9rem" }}>
            this machine is linked to @{handle}. one more thing, then you are done.
          </p>
        </section>
      )}

      {step === "link" && !justLinked && (
        <section className="onboard-stage" key="link">
          <h1 className="title">connect this machine</h1>
          <p className="lede" style={{ marginTop: "0.5rem", fontSize: "0.9rem" }}>
            run this, and paste the code when it asks.
          </p>

          <div style={{ marginTop: "1.5rem" }}>
            <Terminal commands={["tokn link"]} />
          </div>

          <div className="onboard-code" aria-live="polite">
            <span className="micro">your code</span>
            {/* Keyed on the code, so a fresh one rolls in character by character. */}
            <strong key={code} className="onboard-code-value" aria-label={code}>
              {[...code].map((char, i) => (
                <span key={i} aria-hidden="true" style={{ ["--i" as string]: i }}>
                  {char}
                </span>
              ))}
            </strong>
            <span className="micro">
              {remaining === null
                ? " "
                : remaining > 0
                  ? `expires in ${clock(remaining)}`
                  : "expired — fetching a new one"}
            </span>
            <span
              className="onboard-code-bar"
              aria-hidden="true"
              style={{ transform: `scaleX(${remaining === null ? 1 : Math.min(1, remaining / CODE_TTL_MS)})` }}
            />
          </div>

          {error && (
            <p className="micro" style={{ marginTop: "0.75rem", color: "var(--error)" }}>
              {error}
            </p>
          )}

          <p className="micro onboard-waiting">
            <span className="spin" aria-hidden="true" />
            waiting for the machine to connect — this page moves on by itself
          </p>

          <div className="onboard-actions">
            <button type="button" className="btn" onClick={() => void refreshCode()}>
              new code
            </button>
            <button type="button" className="btn" onClick={() => setStep("secure")}>
              do this later
            </button>
          </div>
        </section>
      )}

      {step === "secure" && (
        <section className="onboard-stage" key="secure">
          <h1 className="title">secure your account</h1>
          <p className="lede" style={{ marginTop: "0.5rem", fontSize: "0.9rem" }}>
            {linked
              ? "your machine is linked. one more thing worth thirty seconds: "
              : "worth thirty seconds: "}
            add a passkey so you can sign in with your fingerprint or face instead
            of a password.
          </p>

          {passkeyAdded ? (
            <>
              <p className="micro" style={{ marginTop: "1.25rem" }}>
                a passkey is already on this account.
              </p>
              <div className="onboard-actions">
                <button type="button" className="btn primary" onClick={() => setStep("done")}>
                  continue
                </button>
              </div>
            </>
          ) : canPasskey ? (
            <>
              {error && (
                <p className="micro" style={{ marginTop: "1rem", color: "var(--error)" }}>
                  {error}
                </p>
              )}
              <div className="onboard-actions">
                <button
                  type="button"
                  className="btn primary"
                  onClick={addPasskey}
                  disabled={busy}
                >
                  {busy ? "…" : "add a passkey"}
                </button>
                <button type="button" className="btn" onClick={() => setStep("done")}>
                  not now
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="micro" style={{ marginTop: "1.25rem" }}>
                this browser has no authenticator to offer. you can add one later from
                account settings.
              </p>
              <div className="onboard-actions">
                <button type="button" className="btn primary" onClick={() => setStep("done")}>
                  continue
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {step === "done" && (
        <section className="onboard-stage" key="done">
          <h1 className="title">you are set up</h1>
          <p className="lede" style={{ marginTop: "0.5rem", fontSize: "0.9rem" }}>
            {app
              ? `one last step: approve ${app.name}, and its usage joins yours here.`
              : linked
                ? "run tokn sync whenever you want to publish, or let it run in the background."
                : "install and link whenever you are ready — the steps are on the connect page."}
          </p>

          <div style={{ marginTop: "1.5rem" }}>
            <Terminal commands={linked ? ["tokn sync"] : ["tokn link", "tokn sync"]} />
          </div>

          <div className="onboard-actions">
            {app ? (
              <>
                {/* A full navigation: an app's sign-in is a route that redirects. */}
                <a href={leave} className="btn primary onboard-continue">
                  <img src={app.icon} alt="" width={16} height={16} />
                  continue to {app.name}
                </a>
                <Link href="/account" className="btn">
                  go to your usage
                </Link>
              </>
            ) : (
              <>
                <Link href="/account" className="btn primary">
                  go to your usage
                </Link>
                <Link href={`/profile/${handle}`} className="btn">
                  see your profile
                </Link>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * A live preview of the profile being edited.
 *
 * This is the real `Avatar` component and the real strings, not a drawing of
 * them. The other steps illustrate something the reader cannot see yet; this
 * one shows the actual thing they are making, so it should *be* the thing. It
 * also avoids reimplementing the avatar: the default style derives a gradient
 * from a hash of the handle, and a hand-drawn copy would drift from it the
 * first time that changes.
 *
 * Both strings fall back to a dimmed placeholder rather than collapsing, so the
 * card keeps its shape while the fields are still empty.
 */
function ProfilePreview({
  handle,
  name,
  avatar,
  avatarUrl,
}: {
  handle: string;
  name: string;
  avatar: AvatarStyle;
  avatarUrl: string | null;
}) {
  const shownHandle = handle.trim();
  const shownName = name.trim();
  return (
    <div className="onboard-preview">
      <div className="onboard-preview-card">
        {/* An empty handle would seed the generated gradient off "", so the
            placeholder is fed to the avatar too and the mark stays stable. */}
        <Avatar handle={shownHandle || "you"} size={72} style={avatar} url={avatarUrl} />
        <div className="onboard-preview-text">
          <span className="onboard-preview-name" data-empty={shownName ? undefined : ""}>
            {shownName || "your display name"}
          </span>
          <span className="onboard-preview-handle">@{shownHandle || "your-handle"}</span>
        </div>
      </div>
    </div>
  );
}

/** mm:ss, the same shape the connect page's countdown uses. */
function clock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
