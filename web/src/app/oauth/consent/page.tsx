import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Avatar } from "@/components/Avatar";
import { ConsentForm } from "@/components/ConsentForm";
import { Mark } from "@/components/Mark";
import { clearSessionCookie, currentUser, deleteSession } from "@/lib/auth";
import {
  OAUTH_SCOPES,
  authorizePath,
  authorizeRequest,
  oauthParamsFromRecord,
  safeReturnPath,
  scopeString,
} from "@/lib/backend";
import { parsePrefs } from "@/lib/prefs";

/**
 * /oauth/consent — the "Sign in with tokn" screen.
 *
 * Reached from `GET /oauth/authorize`, which makes the redirects; see the note
 * there for why that half is a route. This page trusts none of it: it runs
 * `authorizeRequest` again on its own query string, and `POST
 * /api/oauth/authorize` runs it once more on the submitted form, so nothing
 * shown here is trusted on the way back either.
 *
 * A link from an unknown app, or one pointing anywhere but the app's own
 * loopback, is refused on this page and never redirected. The redirects below
 * only fire if someone opens this URL directly; the route sends them properly.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in with tokn — tokn",
  robots: { index: false, follow: false },
};

/**
 * Sign out and come straight back to this request as someone else. The return
 * path is re-checked: it arrived in a form field, so it is input like any other.
 */
async function switchAccount(formData: FormData) {
  "use server";
  const back = safeReturnPath(formData.get("next"));
  const sessionId = await clearSessionCookie();
  if (sessionId) await deleteSession(sessionId);
  redirect(back ? `/login?next=${encodeURIComponent(back)}` : "/login");
}

export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = oauthParamsFromRecord(await searchParams);
  const outcome = authorizeRequest(params);

  if (outcome.kind === "invalid") return <Refused reason={outcome.description} />;
  // An error the app should hear about, sent to the loopback it proved it owns.
  if (outcome.kind === "redirect") redirect(outcome.location);

  const here = authorizePath(params);
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(here)}`);

  const { client, redirectUri, codeChallenge, scopes, state } = outcome.request;

  // Only what was validated goes back in the form, not whatever was on the URL.
  const fields: [string, string][] = [
    ["response_type", "code"],
    ["client_id", client.id],
    ["redirect_uri", redirectUri],
    ["code_challenge", codeChallenge],
    ["code_challenge_method", "S256"],
    ["scope", scopeString(scopes)],
  ];
  if (state !== null) fields.push(["state", state]);

  return (
    <div className="onboard-stage" style={{ maxWidth: "27rem", margin: "3rem auto 0", width: "100%" }}>
      <ConnectPair icon={client.icon} />
      <div>
        <p className="micro">sign in with tokn</p>
        <h1 className="title" style={{ marginTop: "0.35rem" }}>
          {client.name} wants to connect to your account
        </h1>
      </div>

      <section style={{ marginTop: "1.75rem" }}>
        <p className="block-label">signed in as</p>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.6rem",
            marginTop: "0.6rem",
            background: "var(--sub-alt)",
            borderRadius: "var(--radius)",
            padding: "0.5rem 0.7rem",
            fontSize: "0.8125rem",
          }}
        >
          <Avatar
            handle={user.handle}
            size={20}
            style={parsePrefs(user.prefs).avatar}
            url={user.avatarUrl}
          />
          <span style={{ marginRight: "auto", minWidth: 0, overflowWrap: "anywhere" }}>
            @{user.handle}
          </span>
          <form action={switchAccount}>
            <input type="hidden" name="next" value={here} />
            <button type="submit" className="btn bare">
              not you? switch
            </button>
          </form>
        </div>
      </section>

      <section style={{ marginTop: "1.75rem" }}>
        <p className="block-label" style={{ marginBottom: "0.75rem" }}>
          {client.name} will be able to
        </p>
        <ul className="plain-list">
          {scopes.map((scope) => (
            <li key={scope}>{OAUTH_SCOPES[scope]}</li>
          ))}
        </ul>
      </section>

      <section style={{ marginTop: "1.75rem" }}>
        <p className="block-label">then it sends you back to</p>
        <p style={{ marginTop: "0.6rem" }}>
          <span className="kbd" style={{ overflowWrap: "anywhere" }}>
            {redirectUri}
          </span>
        </p>
        <p className="micro" style={{ marginTop: "0.6rem" }}>
          this request goes back to an app on your own computer — that address is this machine,
          not a website. if you did not just start signing in from {client.name}, deny it.
        </p>
      </section>

      {/*
        A plain form post, so approving needs no JavaScript and the browser
        follows the 303 to the app's loopback itself. The handler checks the
        Origin header and the session before it signs anything.
      */}
      <ConsentForm fields={fields} appName={client.name} />

      <p className="micro" style={{ marginTop: "1.25rem" }}>
        {client.name} shows up under connected machines on your{" "}
        <Link href="/account" className="main link">
          account
        </Link>
        , where you can revoke it at any time.
      </p>
    </div>
  );
}

/**
 * tokn and the app, with a dot travelling the line between them: what
 * approving does, before a word of it is read.
 */
function ConnectPair({ icon }: { icon: string }) {
  return (
    <div className="consent-pair" aria-hidden="true">
      <span className="consent-tile">
        <Mark size={26} />
      </span>
      <span className="consent-wire">
        <span className="consent-packet" />
      </span>
      <span className="consent-tile">
        <img src={icon} alt="" width={34} height={34} />
      </span>
    </div>
  );
}

/**
 * Shown, never redirected: the address this link wanted to send someone to
 * has not been shown to belong to the app, so it is not used for anything.
 */
function Refused({ reason }: { reason: string }) {
  return (
    <div style={{ maxWidth: "27rem", margin: "3rem auto 0", width: "100%" }}>
      <p className="micro">sign in with tokn</p>
      <h1 className="title" style={{ marginTop: "0.35rem" }}>
        this sign-in link does not work
      </h1>
      <div className="notice" role="alert" style={{ marginTop: "1.25rem" }}>
        {reason}
      </div>
      <p className="lede" style={{ marginTop: "1rem" }}>
        nothing was shared. close this tab and start signing in again from the app.
      </p>
      <p className="micro" style={{ marginTop: "1.5rem" }}>
        <Link href="/" className="main link">
          back to the leaderboard
        </Link>
      </p>
    </div>
  );
}
