import Link from "next/link";
import { findUserByHandle } from "@/lib/auth";
import type { AppSignIn, OAuthClient } from "@/lib/backend";
import { count, niceDate, relative } from "@/lib/format";

/**
 * One app's sign-ins on the owner page: who has linked it, whether they still
 * are, and when they last synced. `query` narrows it to matching handles and
 * names, and says why when nobody matches.
 */

function matches(row: AppSignIn, query: string): boolean {
  const needle = query.toLowerCase();
  return Boolean(row.handle?.toLowerCase().includes(needle) || row.name?.toLowerCase().includes(needle));
}

export async function AppSignIns({
  client,
  rows,
  query,
}: {
  client: OAuthClient;
  rows: AppSignIn[];
  query: string;
}) {
  const shown = query ? rows.filter((row) => matches(row, query)) : rows;
  const linked = rows.filter((row) => row.linked).length;

  return (
    <section>
      <div className="row spread">
        <p className="block-label">{client.name}</p>
        <span className="micro">
          {count(rows.length)} {rows.length === 1 ? "person has" : "people have"} linked it{" "}
          <span className="dot-sep">·</span> {count(linked)} still linked
        </span>
      </div>

      {shown.length === 0 ? (
        <p className="sub" style={{ fontSize: "0.8125rem", marginTop: "0.75rem" }}>
          {query ? await nobody(client, query) : `Nobody has signed in to ${client.name} with tokn yet.`}
        </p>
      ) : (
        <div className="table-wrap" style={{ marginTop: "0.75rem" }}>
          <table className="t">
            <thead>
              <tr>
                <th>person</th>
                <th>status</th>
                <th>version</th>
                <th>first linked</th>
                <th>last sync</th>
                <th>computers</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((row) => (
                <tr key={row.userId}>
                  <td>
                    {row.handle ? (
                      <Link href={`/profile/${encodeURIComponent(row.handle)}`}>@{row.handle}</Link>
                    ) : (
                      <span className="sub">deleted account</span>
                    )}
                    {row.name && <span className="sub"> {row.name}</span>}
                  </td>
                  <td>
                    {row.linked ? (
                      <span className="tag on">linked</span>
                    ) : (
                      <>
                        <span className="tag">unlinked</span>{" "}
                        <span className="sub">{relative(row.unlinkedAt)}</span>
                      </>
                    )}
                  </td>
                  <td className="sub">{row.version ?? "—"}</td>
                  <td className="sub">{niceDate(row.firstLinkedAt)}</td>
                  <td className="sub">{relative(row.lastSyncAt)}</td>
                  <td className="sub" title={row.signIns > 1 ? `${row.signIns} sign-ins in all` : undefined}>
                    {row.computers.join(", ") || "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/** Why a search found nobody: no such account, or an account that never signed in to the app. */
async function nobody(client: OAuthClient, query: string): Promise<string> {
  const someone = await findUserByHandle(query);
  return someone
    ? `@${someone.handle} has a tokn account but has never signed in to ${client.name}.`
    : `Nobody here matches “${query}”, and no tokn account is called @${query}.`;
}
