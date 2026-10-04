"use client";

import { useState } from "react";

/**
 * Approve and deny on the "Sign in with tokn" screen.
 *
 * Still a plain form post, so it works without JavaScript and the browser
 * follows the 303 to the app's loopback itself. The script only adds feedback:
 * once a choice is made the buttons stop taking clicks and approve says what
 * is happening, because the next thing on screen is the app's own page and a
 * second click here would only resubmit.
 *
 * The buttons are never `disabled`: a disabled submitter is left out of the
 * form data, and the server would get no decision at all.
 */
export function ConsentForm({ fields, appName }: { fields: [string, string][]; appName: string }) {
  const [sent, setSent] = useState<"approve" | "deny" | null>(null);

  return (
    <form
      method="post"
      action="/api/oauth/authorize"
      className="consent-actions"
      data-sent={sent ?? undefined}
      onSubmit={(event) => {
        if (sent) {
          event.preventDefault();
          return;
        }
        const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
        setSent(submitter?.value === "deny" ? "deny" : "approve");
      }}
    >
      {fields.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <button type="submit" name="decision" value="deny" className="btn" aria-disabled={sent ? "true" : undefined}>
        deny
      </button>
      <button
        type="submit"
        name="decision"
        value="approve"
        className="btn primary"
        aria-disabled={sent ? "true" : undefined}
        aria-label={`approve ${appName}`}
      >
        {sent === "approve" ? (
          <>
            <span className="consent-spin" aria-hidden="true" />
            connecting…
          </>
        ) : (
          "approve"
        )}
      </button>
    </form>
  );
}
