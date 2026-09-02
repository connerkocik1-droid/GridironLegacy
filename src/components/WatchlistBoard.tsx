"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import NewsWire from "./NewsWire";
import { player as pooled } from "@/lib/roster";
import type { Story } from "@/lib/news";

/**
 * The players you are keeping an eye on.
 *
 * A watchlist is a note to yourself about a decision you have not made yet, so
 * the thing it has to answer first is "can I still have him" — owned, on the
 * wire, or free. That is why ownership is on the row rather than a click away.
 *
 * The news underneath is the other half. The reason to watch a player you do
 * not own is to hear about his hamstring before you spend a claim on him, and
 * a watchlist with no news attached is a list of names you have to go and look
 * up somewhere else.
 */

interface Watched {
  name: string;
  addedAt: string;
  owner: { id: string; slot: string; franchise: string; mine: boolean } | null;
  clearsAt: string | null;
}

const card: React.CSSProperties = {
  border: "1px solid rgba(145,132,217,.22)",
  borderRadius: "var(--radius-lg)",
  background: "rgba(26,28,43,.55)",
  overflow: "hidden",
};

const label: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: ".2em",
  color: "#75798c",
};

/** "Free", "on waivers until Tuesday", or whose team he is on. */
function standing(w: Watched): { text: string; colour: string } {
  if (w.owner) {
    return w.owner.mine
      ? { text: "On your roster", colour: "#7fd1a8" }
      : { text: w.owner.franchise, colour: "#9397ab" };
  }
  if (w.clearsAt) {
    const when = new Date(w.clearsAt);
    const label = Number.isNaN(when.getTime())
      ? "on waivers"
      : `on waivers until ${when.toLocaleString(undefined, {
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        })}`;
    return { text: label, colour: "#e0b573" };
  }
  return { text: "Free agent", colour: "#b5abfc" };
}

export default function WatchlistBoard() {
  const [watching, setWatching] = useState<Watched[] | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, wire] = await Promise.all([
        fetch("/api/watchlist", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
        fetch("/api/news").then((r) => (r.ok ? r.json() : { stories: [] })),
      ]);

      if (!list) {
        setError("Sign in to keep a watchlist.");
        return;
      }
      setWatching(list.watching ?? []);
      setStories(wire.stories ?? []);
      setError(null);
    } catch {
      setError("Could not read your watchlist.");
    }
  }, []);

  useEffect(() => {
    // Sets state only once the requests resolve, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /**
   * Removed from the list before the request comes back. A watchlist is a note
   * to yourself; waiting on a round trip to watch a name disappear is the
   * wrong amount of ceremony for one.
   */
  async function stopWatching(name: string) {
    if (busy) return;
    setBusy(name);
    const before = watching;
    setWatching((was) => (was ?? []).filter((w) => w.name !== name));

    try {
      const res = await fetch(`/api/watchlist?player=${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error();
    } catch {
      setWatching(before);
      setError("Could not stop watching that player.");
    } finally {
      setBusy(null);
    }
  }

  const names = useMemo(() => new Set((watching ?? []).map((w) => w.name)), [watching]);

  const theirNews = useMemo(
    () => stories.filter((s) => s.players.some((p) => names.has(p))),
    [stories, names],
  );

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 18px 44px" }}>
      <div style={{ margin: "26px 0 6px" }}>
        <Link
          href="/my-team"
          style={{
            display: "inline-flex",
            alignItems: "center",
            minHeight: 34,
            fontSize: 11.5,
            color: "#b5abfc",
            textDecoration: "none",
          }}
        >
          ← My Team
        </Link>
      </div>

      <div style={label}>KEEPING AN EYE ON</div>
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 28,
          letterSpacing: "-.025em",
          margin: "7px 0 10px",
          fontWeight: 500,
          color: "#e9e9ed",
        }}
      >
        Watchlist
      </h1>
      <p style={{ fontSize: 12.5, color: "#9397ab", lineHeight: 1.65, margin: "0 0 18px" }}>
        Players you have not decided about yet. Watching one changes nothing and
        commits nothing — it only means their news reaches you.
      </p>

      {error ? (
        <div style={{ ...card, padding: "14px 16px", fontSize: 12.5, color: "#e0b573" }}>
          {error}
        </div>
      ) : null}

      {!watching ? (
        <div style={{ fontSize: 12.5, color: "#75798c" }}>Reading your watchlist…</div>
      ) : watching.length === 0 ? (
        <div style={{ ...card, padding: "18px 20px", fontSize: 12.5, color: "#9397ab", lineHeight: 1.65 }}>
          Nobody yet. Watch a player from the free agents page and he will turn
          up here, along with anything the wire says about him.
          <div style={{ marginTop: 12 }}>
            <Link
              href="/free-agents"
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: 34,
                color: "#b5abfc",
                textDecoration: "none",
                fontSize: 12,
              }}
            >
              Find somebody to watch →
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div style={card}>
            {watching.map((w) => {
              const p = pooled(w.name);
              const where = standing(w);

              return (
                <div
                  key={w.name}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 16px",
                    borderTop: "1px solid rgba(145,132,217,.14)",
                    flexWrap: "wrap",
                  }}
                >
                  <div style={{ minWidth: 0, flex: "1 1 180px" }}>
                    <div
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontSize: 15.5,
                        color: "#e9e9ed",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {w.name}
                    </div>
                    <div style={{ fontSize: 11, color: "#75798c", marginTop: 2 }}>
                      {p ? `${p.p} · ${p.t}` : "Not in the pool"}
                      {p?.bye ? ` · bye ${p.bye}` : ""}
                    </div>
                  </div>

                  <div
                    style={{
                      fontSize: 11.5,
                      color: where.colour,
                      flex: "0 1 auto",
                      textAlign: "right",
                    }}
                  >
                    {where.text}
                  </div>

                  <button
                    onClick={() => void stopWatching(w.name)}
                    disabled={busy === w.name}
                    aria-label={`Stop watching ${w.name}`}
                    style={{
                      minHeight: 34,
                      padding: "6px 11px",
                      border: "1px solid rgba(145,132,217,.3)",
                      background: "transparent",
                      color: "#9397ab",
                      borderRadius: "var(--radius-sm)",
                      font: "inherit",
                      fontSize: 11,
                      cursor: busy === w.name ? "default" : "pointer",
                      flex: "0 0 auto",
                    }}
                  >
                    Stop watching
                  </button>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 12, fontSize: 11.5 }}>
            <Link
              href="/free-agents"
              style={{
                display: "inline-flex",
                alignItems: "center",
                minHeight: 34,
                color: "#b5abfc",
                textDecoration: "none",
              }}
            >
              Watch somebody else →
            </Link>
          </div>

          <div style={{ ...label, margin: "26px 0 10px" }}>WHAT THE WIRE SAYS ABOUT THEM</div>
          <div style={card}>
            <NewsWire
              stories={theirNews.slice(0, 8)}
              highlight={names}
              emptyMessage="Nothing about the players you are watching just now."
            />
          </div>
        </>
      )}
    </div>
  );
}
