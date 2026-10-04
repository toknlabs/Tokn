import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Onboarding } from "@/components/Onboarding";
import { HANDLE_CHANGE_LIMIT, currentUser, issueLinkCode } from "@/lib/auth";
import { appWaitingAt, listDevices, listPasskeys, oauthAppForDevice, safeReturnPath } from "@/lib/backend";
import { parsePrefs } from "@/lib/prefs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Welcome — tokn" };

/**
 * Shown once, right after signing up.
 *
 * The link code is issued here rather than fetched by the client so the first
 * paint already has one. The reader is being asked to switch to a terminal,
 * and a spinner where the code should be is exactly the wrong thing to hand
 * them at that moment.
 *
 * `?next=` is where the new account was headed when it signed up. When that
 * is an app's sign-in ("Sign in with tokn" from Eaon Desktop), the flow says
 * which app is waiting and every way out of it leads back there, so setting up
 * never costs them the connection they came to make.
 */
export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const returnTo = safeReturnPath(next);

  const user = await currentUser();
  if (!user) {
    const here = returnTo ? `/welcome?next=${encodeURIComponent(returnTo)}` : "/welcome";
    redirect(`/login?next=${encodeURIComponent(here)}`);
  }

  const [{ code, expiresAt }, devices, passkeys] = await Promise.all([
    issueLinkCode(user.id),
    listDevices(user.id),
    listPasskeys(user.id),
  ]);

  // An app signed in with tokn is a row in `devices` too, but it is not a
  // machine running the CLI, so it does not skip the install steps.
  const machines = devices.filter((device) => !oauthAppForDevice(device.$id, device.cliVersion));
  const app = appWaitingAt(returnTo);

  return (
    <Onboarding
      handle={user.handle}
      initialName={user.name}
      initialAvatar={parsePrefs(user.prefs).avatar}
      avatarUrl={user.avatarUrl ?? null}
      handleChangesLeft={user.handleChangesLeft ?? HANDLE_CHANGE_LIMIT}
      initialCode={code}
      initialExpiry={expiresAt}
      alreadyLinked={machines.length > 0}
      hasPasskey={passkeys.length > 0}
      returnTo={returnTo}
      app={app ? { name: app.name, icon: app.icon } : null}
    />
  );
}
