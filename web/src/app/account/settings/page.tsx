import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Appearance } from "@/components/Appearance";
import { DeleteAccount } from "@/components/DeleteAccount";
import { LinkFields } from "@/components/LinkFields";
import { Passkeys } from "@/components/Passkeys";
import { PlanFields } from "@/components/PlanFields";
import { SettingsGroup } from "@/components/SettingsGroup";
import { Visibility } from "@/components/Visibility";
import {
  HANDLE_CHANGE_LIMIT,
  changeHandle,
  currentUser,
  saveProfile as persistProfile,
} from "@/lib/auth";
import { listPasskeys } from "@/lib/backend";
import { parseLinks, serializeLinks } from "@/lib/links";
import { billingFromPlans, parsePlans, serializePlans } from "@/lib/plans";
import {
  parsePrefs,
  BLOCKS,
  prefsFromForm,
  serializePrefs,
  withBlock,
} from "@/lib/prefs";
import { ISSUES_URL } from "@/lib/site";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settings — tokn" };

/** Where "contact support" points. */
const SUPPORT_URL = ISSUES_URL;

const MAX_NAME = 60;
const MAX_BIO = 160;

async function saveProfile(formData: FormData) {
  "use server";
  const user = await currentUser();
  if (!user) redirect("/login?next=/account/settings");

  const name = String(formData.get("name") ?? "")
    .trim()
    .slice(0, MAX_NAME);
  const bio = String(formData.get("bio") ?? "")
    .trim()
    .slice(0, MAX_BIO);
  const billing =
    formData.get("billing") === "subscription" ? "subscription" : "api";
  const links = serializeLinks(formData.getAll("link").map(String));
  // Rows arrive as parallel arrays, one entry per row, in display order.
  const providers = formData.getAll("plan.provider").map(String);
  const labels = formData.getAll("plan.label").map(String);
  const names = formData.getAll("plan.plan").map(String);
  const kinds = formData.getAll("plan.kind").map(String);
  const monthlies = formData.getAll("plan.monthly").map(String);

  const submitted = providers.map((provider, index) => ({
    provider,
    label: labels[index] ?? "",
    plan: names[index] ?? "",
    kind: kinds[index] ?? "subscription",
    monthlyUsd: monthlies[index] ?? "",
  }));

  const plans = serializePlans(submitted);
  const parsedPlans = parsePlans(plans);

  let prefsObject = prefsFromForm({
    accent: formData.get("accent"),
    avatar: formData.get("avatar"),
    blocks: formData.getAll("block"),
    stats: formData.getAll("stat"),
    looks: Object.fromEntries(
      BLOCKS.map((block) => [block, formData.get(`look.${block}`)]),
    ),
    half: formData.getAll("half"),
  });

  // Someone filling this in for the first time has a preferences blob written
  // before the block existed, so turn it on rather than silently not showing
  // what they just typed.
  if (parsedPlans.length > 0) prefsObject = withBlock(prefsObject, "plans");

  const prefs = serializePrefs(prefsObject);

  const requested = String(formData.get("handle") ?? "").trim();
  if (requested && requested !== user.handle) {
    const renamed = await changeHandle(user.id, requested);
    if (!renamed.ok) {
      // Stop before the rest of the save: a rejected handle should not leave
      // the other fields half-written with no explanation.
      redirect(`/account/settings?error=${encodeURIComponent(renamed.error)}`);
    }
  }

  await persistProfile(user.id, {
    name: name || null,
    bio: bio || null,
    // Derived from the plans when there are any, so the leaderboard's `plan`
    // tag cannot contradict the list on the same person's profile.
    billing: billingFromPlans(parsedPlans, billing),
    links,
    prefs,
    plans,
    isPublic: formData.get("isPublic") === "on",
    listed: formData.get("listed") === "on",
  });

  redirect("/account/settings?saved=1");
}

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const user = await currentUser();
  const { saved, error } = await searchParams;

  if (!user) {
    return (
      <section>
        <h1 className="title">settings</h1>
        <p className="lede" style={{ marginTop: "0.5rem" }}>
          <Link href="/login?next=/account/settings" className="main link">
            sign in
          </Link>{" "}
          to edit your profile
        </p>
      </section>
    );
  }

  const links = parseLinks(user.links).map((link) => link.url);
  const passkeys = (await listPasskeys(user.id)).map((key) => ({
    id: key.$id,
    label: key.label ?? "passkey",
    createdAt: key.createdAt,
    lastUsedAt: key.lastUsedAt ?? null,
  }));
  const left = user.handleChangesLeft;
  const locked = left <= 0;

  return (
    <>
      <section>
        <h1 className="title">settings</h1>
        <p className="lede" style={{ marginTop: "0.5rem" }}>
          how you appear on the leaderboard and on your public profile
        </p>
      </section>

      {saved && <div className="notice ok">saved</div>}
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}

      <form action={saveProfile}>
        <SettingsGroup title="profile" note="who you are on the board">
          <div className="setting">
            <label className="setting-label" htmlFor="handle">
              handle
              <small>
                {locked
                  ? "no changes left"
                  : `${left} of ${HANDLE_CHANGE_LIMIT} ${left === 1 ? "change" : "changes"} left`}
              </small>
            </label>
            <div>
              {locked ? (
                <p style={{ paddingTop: "0.55rem", fontSize: "0.8125rem" }}>
                  <span className="sub">tokn.dev/profile/</span>
                  <span className="main">{user.handle}</span>
                </p>
              ) : (
                <div className="prefixed">
                  <span className="prefix">tokn.dev/profile/</span>
                  <input
                    id="handle"
                    name="handle"
                    className="input"
                    defaultValue={user.handle}
                    maxLength={24}
                    spellCheck={false}
                    autoCapitalize="none"
                    autoComplete="off"
                  />
                </div>
              )}
              <p className="micro" style={{ marginTop: "0.5rem" }}>
                {locked ? (
                  <>
                    you have used both handle changes.{" "}
                    <a
                      href={SUPPORT_URL}
                      className="main link"
                      target="_blank"
                      rel="noreferrer"
                    >
                      contact support
                    </a>{" "}
                    if you need another.
                  </>
                ) : (
                  <>
                    a handle can be changed {HANDLE_CHANGE_LIMIT} times. after
                    that it takes a word with{" "}
                    <a
                      href={SUPPORT_URL}
                      className="main link"
                      target="_blank"
                      rel="noreferrer"
                    >
                      support
                    </a>
                    . old links stop working, so choose carefully.
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="setting">
            <label className="setting-label" htmlFor="name">
              display name
              <small>shown above your handle</small>
            </label>
            <input
              id="name"
              name="name"
              className="input"
              defaultValue={user.name ?? ""}
              maxLength={MAX_NAME}
              placeholder="your name"
            />
          </div>

          <div className="setting">
            <label className="setting-label" htmlFor="bio">
              bio
              <small>one line, on your profile</small>
            </label>
            <input
              id="bio"
              name="bio"
              className="input"
              defaultValue={user.bio ?? ""}
              maxLength={MAX_BIO}
              placeholder="what you are building"
            />
          </div>

          <div className="setting">
            <div className="setting-label">
              links
              <small>github, x, linkedin or your own site</small>
            </div>
            <LinkFields initial={links} />
          </div>
        </SettingsGroup>

        <Appearance
          handle={user.handle}
          initial={parsePrefs(user.prefs)}
          avatarUrl={user.avatarUrl}
        />

        <SettingsGroup title="privacy" note="who can see you, and where">
          <Visibility
            initialPublic={user.isPublic}
            initialListed={user.listed}
          />
        </SettingsGroup>

        <SettingsGroup title="security" note="how you sign in">
          <Passkeys initial={passkeys} />
        </SettingsGroup>

        <SettingsGroup
          title="billing"
          note="what you pay for, and how your cost is read"
        >
          <div className="setting">
            <div className="setting-label">
              plans
              <small>shown on your profile · nothing here is verified</small>
            </div>
            <PlanFields initial={parsePlans(user.plans)} />
          </div>

          <div className="setting">
            <label className="setting-label" htmlFor="billing">
              how you pay
              <small>
                changes how your cost reads, not how it is calculated
              </small>
            </label>
            <select
              id="billing"
              name="billing"
              className="input"
              defaultValue={user.billing}
            >
              <option value="api">
                api billing — the cost shown is what I paid
              </option>
              <option value="subscription">
                subscription — equivalent api spend
              </option>
            </select>
          </div>
        </SettingsGroup>

        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            marginTop: "1rem",
            gap: "0.5rem",
          }}
        >
          <Link href={`/profile/${user.handle}`} className="btn">
            view profile
          </Link>
          <button type="submit" className="btn primary">
            save
          </button>
        </div>
      </form>
      <SettingsGroup title="your data" note="everything this account holds, in a file">
        <p className="micro" style={{ lineHeight: 1.7, marginBottom: "1rem" }}>
          the csv is your usage rows, one per day, tool and model — the numbers behind
          every figure on your profile, so you can check our arithmetic against your
          own. the json adds your profile, connected machines and passkey labels.
          neither contains your password or any device token.
        </p>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {/* Plain links, not fetch: the browser already knows how to save a
              file it is handed, and Content-Disposition names it. */}
          <a className="btn" href="/api/account/export?format=csv" download>
            download csv
          </a>
          <a className="btn" href="/api/account/export?format=json" download>
            download json
          </a>
        </div>
      </SettingsGroup>

      <SettingsGroup title="danger" note="this cannot be undone">
        <DeleteAccount handle={user.handle} />
      </SettingsGroup>
    </>
  );
}
