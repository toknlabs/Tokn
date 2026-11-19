"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Avatar } from "@/components/Avatar";
import { ModelName } from "@/components/BrandLogo";
import type { SerializedLogo } from "@/lib/logos";

/**
 * Friends: the roster, the requests waiting on either side, and a board of
 * just these people.
 *
 * The board is a roster rather than a ranking, so a friend who has not synced
 * yet still appears, marked, instead of quietly missing. On day one that is
 * everybody including you, and an empty page would read as broken.
 */

interface Person {
  id: string;
  handle: string;
  name?: string;
  avatarUrl?: string;
}

interface BoardRow {
  userId: string;
  handle: string;
  rank: number;
  value: number;
  isSelf: boolean;
  lastSyncAt?: string | null;
  topModel?: string | null;
  topModelLogo?: SerializedLogo | null;
  activeDays: number;
}

type Metric = "cost" | "tokens" | "requests";
type Window = "all" | "30d" | "7d";

const METRICS: { key: Metric; label: string }[] = [
  { key: "cost", label: "cost" },
  { key: "tokens", label: "tokens" },
  { key: "requests", label: "requests" },
];

const WINDOWS: { key: Window; label: string }[] = [
  { key: "all", label: "all time" },
  { key: "30d", label: "30 days" },
  { key: "7d", label: "7 days" },
];

function format(value: number, metric: Metric): string {
  if (metric === "cost") {
    return value >= 100
      ? `$${Math.round(value).toLocaleString("en-US")}`
      : `$${value.toFixed(2)}`;
  }
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(Math.round(value));
}

export function FriendsPanel() {
  const [friends, setFriends] = useState<Person[]>([]);
  const [incoming, setIncoming] = useState<Person[]>([]);
  const [outgoing, setOutgoing] = useState<Person[]>([]);
  const [board, setBoard] = useState<BoardRow[]>([]);
  const [metric, setMetric] = useState<Metric>("cost");
  const [window, setWindow] = useState<Window>("all");

  const [handle, setHandle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    const [listRes, boardRes] = await Promise.all([
      fetch("/api/friends", { cache: "no-store" }),
      fetch(`/api/friends/board?window=${window}&metric=${metric}`, { cache: "no-store" }),
    ]);

    if (listRes.ok) {
      const data = (await listRes.json()) as {
        friends: Person[];
        incoming: Person[];
        outgoing: Person[];
      };
      setFriends(data.friends);
      setIncoming(data.incoming);
      setOutgoing(data.outgoing);
    }
    if (boardRes.ok) {
      setBoard(((await boardRes.json()) as { entries: BoardRow[] }).entries);
    }
    setLoaded(true);
  }, [metric, window]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: "add" | "accept" | "remove", who: string) {
    setBusy(true);
    setError(null);
    setNote(null);

    try {
      const response = await fetch("/api/friends", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, handle: who }),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        status?: string;
      };

      if (!response.ok) {
        setError(data.error ?? "that did not work");
        return;
      }

      if (action === "add") {
        // Asking back someone who already asked you completes it immediately.
        setNote(
          data.status === "accepted"
            ? `you and @${who} are now friends`
            : `request sent to @${who}`,
        );
        setHandle("");
      }
      await load();
    } catch {
      setError("could not reach the server");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {/* ------------------------------------------------------------- add */}

      <section>
        <p className="block-label" style={{ marginBottom: "0.75rem" }}>
          add someone
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const clean = handle.trim().replace(/^@/, "");
            if (clean) void act("add", clean);
          }}
          style={{ display: "flex", gap: "0.6rem", maxWidth: "26rem" }}
        >
          <input
            className="input"
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="their handle"
            autoCapitalize="none"
            spellCheck={false}
            aria-label="handle to add"
            style={{ flex: 1 }}
          />
          <button type="submit" className="btn" disabled={busy || handle.trim().length === 0}>
            {busy ? "…" : "add"}
          </button>
        </form>

        {error && (
          <div className="notice" role="alert" style={{ marginTop: "0.8rem", maxWidth: "26rem" }}>
            {error}
          </div>
        )}
        {note && (
          <p className="micro" style={{ marginTop: "0.8rem", color: "var(--main)" }}>
            {note}
          </p>
        )}
      </section>

      {/* -------------------------------------------------------- requests */}

      {incoming.length > 0 && (
        <section style={{ marginTop: "2.5rem" }}>
          <p className="block-label" style={{ marginBottom: "0.9rem" }}>
            waiting on you
          </p>
          {incoming.map((person) => (
            <div
              key={person.id}
              style={{ display: "flex", alignItems: "center", gap: "0.7rem", padding: "0.45rem 0" }}
            >
              <Avatar handle={person.handle} size={26} url={person.avatarUrl} />
              <Link href={`/profile/${person.handle}`} className="link" style={{ flex: 1 }}>
                @{person.handle}
              </Link>
              <button type="button" className="btn" disabled={busy} onClick={() => void act("accept", person.handle)}>
                accept
              </button>
              <button type="button" className="btn bare" disabled={busy} onClick={() => void act("remove", person.handle)}>
                decline
              </button>
            </div>
          ))}
        </section>
      )}

      {outgoing.length > 0 && (
        <section style={{ marginTop: "2.5rem" }}>
          <p className="block-label" style={{ marginBottom: "0.9rem" }}>
            waiting on them
          </p>
          {outgoing.map((person) => (
            <div
              key={person.id}
              style={{ display: "flex", alignItems: "center", gap: "0.7rem", padding: "0.45rem 0" }}
            >
              <Avatar handle={person.handle} size={26} url={person.avatarUrl} />
              <span className="sub" style={{ flex: 1 }}>@{person.handle}</span>
              <button type="button" className="btn bare" disabled={busy} onClick={() => void act("remove", person.handle)}>
                cancel
              </button>
            </div>
          ))}
        </section>
      )}

      {/* ----------------------------------------------------------- board */}

      <section style={{ marginTop: "2.75rem" }}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            justifyContent: "space-between",
            gap: "1rem",
            flexWrap: "wrap",
            marginBottom: "1rem",
          }}
        >
          <p className="block-label">your board</p>
          <div style={{ display: "flex", gap: "1rem" }}>
            <Switcher options={METRICS} value={metric} onChange={setMetric} />
            <Switcher options={WINDOWS} value={window} onChange={setWindow} />
          </div>
        </div>

        {!loaded ? (
          <p className="micro">loading…</p>
        ) : board.length <= 1 ? (
          <p className="micro" style={{ lineHeight: 1.75 }}>
            Nobody here yet. Add someone by handle above and this becomes a board of just the two
            of you.
          </p>
        ) : (
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: "0.8125rem",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            <tbody>
              {board.map((row) => (
                <tr key={row.userId}>
                  <td className="sub" style={{ padding: "0.42rem 0", width: "2.2rem" }}>
                    {row.rank}
                  </td>
                  <td style={{ paddingRight: "0.7rem", width: "2rem" }}>
                    <Avatar handle={row.handle} size={22} />
                  </td>
                  <td>
                    <Link
                      href={`/profile/${row.handle}`}
                      className="link"
                      style={{ color: row.isSelf ? "var(--main)" : undefined }}
                    >
                      @{row.handle}
                    </Link>
                    {row.isSelf && <span className="micro"> · you</span>}
                    {!row.lastSyncAt && <span className="micro"> · never synced</span>}
                  </td>
                  <td className="sub" style={{ textAlign: "right", paddingRight: "1.1rem" }}>
                    {row.topModel ? (
                      <ModelName
                        model={row.topModel}
                        label={row.topModel.replace(/^claude-/, "")}
                        logo={row.topModelLogo}
                        size={13}
                      />
                    ) : (
                      ""
                    )}
                  </td>
                  <td style={{ textAlign: "right", width: "6rem" }}>
                    {row.lastSyncAt ? format(row.value, metric) : <span className="sub">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* --------------------------------------------------------- roster */}

      {friends.length > 0 && (
        <section style={{ marginTop: "2.75rem" }}>
          <p className="block-label" style={{ marginBottom: "0.9rem" }}>
            {friends.length} {friends.length === 1 ? "friend" : "friends"}
          </p>
          {friends.map((person) => (
            <div
              key={person.id}
              style={{ display: "flex", alignItems: "center", gap: "0.7rem", padding: "0.45rem 0" }}
            >
              <Avatar handle={person.handle} size={26} url={person.avatarUrl} />
              <Link href={`/profile/${person.handle}`} className="link" style={{ flex: 1 }}>
                @{person.handle}
                {person.name && <span className="sub"> · {person.name}</span>}
              </Link>
              <button type="button" className="btn bare" disabled={busy} onClick={() => void act("remove", person.handle)}>
                remove
              </button>
            </div>
          ))}
        </section>
      )}
    </>
  );
}

function Switcher<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { key: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
}) {
  return (
    <div style={{ display: "flex", gap: "0.55rem" }}>
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          className="btn bare micro"
          onClick={() => onChange(option.key)}
          style={{
            padding: 0,
            color: option.key === value ? "var(--main)" : "var(--sub)",
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
