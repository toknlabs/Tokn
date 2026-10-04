import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { ProfileView } from "@/components/ProfileView";
import { Terminal } from "@/components/Terminal";
import { niceDay, relative } from "@/lib/format";
import {
  clearSessionCookie,
  currentUser,
  deleteSession,
  listDevices,
  revokeDevice,
} from "@/lib/auth";
import { CliUpdateNotice } from "@/components/CliUpdateNotice";
import { oauthAppForDevice } from "@/lib/backend";
import { latestCliVersion, outdatedDevices } from "@/lib/cli-version";
import { SETUP_SEEN_COOKIE } from "@/lib/onboarding";
import { rankOf, syncInfo } from "@/lib/stats";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Account — tokn" };

async function revoke(formData: FormData) {
  "use server";
  const user = await currentUser();
  if (!user) return;
  const deviceId = formData.get("deviceId");
  if (typeof deviceId === "string") await revokeDevice(user.id, deviceId);
  redirect("/account");
}

/**
 * "Eaon Desktop · ada.local". An app that did not send a device name was
 * recorded under its own name, which would otherwise read twice.
 */
function appHost(name: string, hostname: string | null): string {
  return hostname && hostname !== name ? `${name} · ${hostname}` : name;
}

async function signOut() {
  "use server";
  const sessionId = await clearSessionCookie();
  if (sessionId) await deleteSession(sessionId);
  redirect("/");
}

export default async function AccountPage() {
  const user = await currentUser();
  if (!user) redirect("/login?next=/account");

  const devices = await listDevices(user.id);

  // Accounts that predate the welcome flow never saw it, and neither did
  // anyone who signed up and wandered off before linking. Both look the same
  // from here — no machine connected — and both still have the whole setup
  // ahead of them, so offer it once. The flow marks the browser as it opens,
  // which is what stops this firing again for someone who skips.
  const jar = await cookies();
  if (devices.length === 0 && jar.get(SETUP_SEEN_COOKIE)?.value !== "1") {
    redirect("/welcome");
  }

  const sync = await syncInfo(user.id);

  // npm, not Appwrite, and cached for six hours: this costs nothing against
  // the database budget and cannot fail the page if the registry is down.
  const latest = await latestCliVersion();

  // Apps signed in with "Sign in with tokn" are rows here too, recorded with
  // their app's name and version. They are not the CLI, so they are labelled
  // as the app and left out of the CLI update notice.
  const rows = devices.map((device) => ({
    device,
    app: oauthAppForDevice(device.id, device.cli_version),
  }));
  const stale = outdatedDevices(
    rows.filter((row) => !row.app).map((row) => row.device),
    latest,
  );

  return (
    <>
      {latest && stale.length > 0 && <CliUpdateNotice devices={stale} latest={latest} />}

      <ProfileView
        user={{
          id: user.id,
          handle: user.handle,
          name: user.name,
          bio: user.bio,
          createdAt: user.created_at,
          billing: user.billing,
          links: user.links,
          prefs: user.prefs ?? null,
          plans: user.plans ?? null,
          avatarUrl: user.avatarUrl ?? null,
          isPublic: user.isPublic,
          listed: user.listed,
        }}
        rank={await rankOf(user.id, "all", "cost")}
        own
        identity={false}
      />

      <hr className="divider" style={{ marginTop: "1rem" }} />

      <section>
        <div className="row spread">
          <p className="block-label">connected machines</p>
          <span className="micro">
            {devices.length === 0
              ? "none yet"
              : `last sync ${relative(sync.lastSyncAt)}`}
          </span>
        </div>

        {devices.length === 0 ? (
          <div style={{ maxWidth: "28rem" }}>
            <p
              className="sub"
              style={{ fontSize: "0.8125rem", marginBottom: "1rem" }}
            >
              no machine is reporting yet — install the cli and connect one
            </p>
            <Terminal commands={["npm install -g toknhq", "tokn link"]} />
            <Link
              href="/link"
              className="btn primary"
              style={{ marginTop: "1rem" }}
            >
              get a link code
            </Link>
          </div>
        ) : (
          <>
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>host</th>
                    <th>platform</th>
                    <th>version</th>
                    <th>connected</th>
                    <th>last sync</th>
                    <th className="r" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map(({ device, app }) => (
                    <tr key={device.id}>
                      <td>
                        {app
                          ? appHost(app.client.name, device.hostname)
                          : (device.hostname ?? "unknown")}
                      </td>
                      <td className="sub">{device.platform ?? "—"}</td>
                      <td className="sub">
                        {(app ? app.version : device.cli_version) ?? "—"}
                      </td>
                      <td className="sub">
                        {niceDay(device.linked_at.slice(0, 10))}
                      </td>
                      <td className="sub">{relative(device.last_sync_at)}</td>
                      <td className="r">
                        <form action={revoke}>
                          <input
                            type="hidden"
                            name="deviceId"
                            value={device.id}
                          />
                          <button
                            type="submit"
                            className="btn bare"
                            title="Revoke this token"
                          >
                            revoke
                          </button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: "1rem",
                marginTop: "1rem",
                flexWrap: "wrap",
              }}
            >
              <span className="micro">
                revoking kills the token immediately —{" "}
                <span className="kbd">tokn unlink</span> only clears local
                config
              </span>
              <Link href="/link" className="btn">
                connect another
              </Link>
            </div>
          </>
        )}
      </section>

      <hr className="divider" />

      <section
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: "1rem",
          flexWrap: "wrap",
        }}
      >
        <div>
          <p className="block-label">signed in as</p>
          <p className="sub" style={{ marginTop: "0.3rem" }}>
            {user.handle} <span className="dot-sep">·</span> billing{" "}
            {user.billing}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <Link href="/account/settings" className="btn">
            settings
          </Link>
          <form action={signOut}>
            <button type="submit" className="btn">
              sign out
            </button>
          </form>
        </div>
      </section>
    </>
  );
}
