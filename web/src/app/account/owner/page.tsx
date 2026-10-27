import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AppSignIns } from "@/components/AppSignIns";
import { currentUser } from "@/lib/auth";
import { OAUTH_CLIENTS, listAppSignIns } from "@/lib/backend";
import { isOwner } from "@/lib/owner";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Owner — tokn",
  robots: { index: false, follow: false },
};

/**
 * For the people who run tokn: who has signed in to each app with tokn
 * ("Sign in with tokn" from Eaon Desktop), whether they still are, and when
 * they last synced. Private profiles included, which is why it is the owners'
 * alone: to anyone else this page does not exist.
 *
 * Search takes a handle, with or without the @, or part of one or of a name.
 * A handle that matches nobody here is looked up, to tell "has an account but
 * never signed in" from "no such account".
 */

export default async function OwnerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (!user || !isOwner(user.id)) notFound();

  const raw = (await searchParams).q;
  const query = (typeof raw === "string" ? raw : "").trim().replace(/^@/, "");

  const apps = await Promise.all(
    OAUTH_CLIENTS.map(async (client) => ({ client, rows: await listAppSignIns(client) })),
  );

  return (
    <>
      <section>
        <h1 className="title">owner</h1>
        <p className="lede" style={{ marginTop: "0.75rem" }}>
          Who has linked their tokn account to an app with &ldquo;Sign in with tokn&rdquo;. Only the
          accounts in <span className="kbd">TOKN_OWNER_IDS</span> can see this page.
        </p>
      </section>

      <form method="get" style={{ display: "flex", gap: "0.6rem", maxWidth: "26rem" }}>
        <input
          className="input"
          name="q"
          defaultValue={query}
          placeholder="find a handle or name"
          aria-label="Find a handle or name"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="btn">
          find
        </button>
        {query && (
          <Link href="/account/owner" className="btn bare">
            clear
          </Link>
        )}
      </form>

      {apps.map(({ client, rows }) => (
        <AppSignIns key={client.id} client={client} rows={rows} query={query} />
      ))}
    </>
  );
}
