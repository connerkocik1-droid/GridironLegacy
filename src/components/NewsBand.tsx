"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import NewsWire from "./NewsWire";
import type { Story } from "@/lib/news";

const card: React.CSSProperties = {
  border: "1px solid rgba(145,132,217,.22)",
  borderRadius: "var(--radius-lg)",
  background: "rgba(26,28,43,.55)",
  overflow: "hidden",
};

const tab = (on: boolean): React.CSSProperties => ({
  padding: "6px 11px",
  fontSize: 10,
  letterSpacing: ".12em",
  textTransform: "uppercase",
  border: `1px solid ${on ? "rgba(181,171,252,.6)" : "rgba(145,132,217,.24)"}`,
  background: on ? "rgba(145,132,217,.26)" : "transparent",
  color: on ? "#e9e9ed" : "#9397ab",
  borderRadius: "var(--radius-sm)",
  font: "inherit",
  cursor: "pointer",
});

/**
 * The wire on the home page, in two halves.
 *
 * League News is everything, the same for everybody. Player News is the part
 * of it that is about this manager: the players on their roster, and the ones
 * they have said they are watching — the player you do not own yet and are
 * deciding about is exactly the one whose hamstring you want to hear about.
 *
 * Only the first few of each; the whole wire is a page, and this band is the
 * part worth a glance from the home page.
 */
export default function NewsBand({ limit = 4 }: { limit?: number }) {
  const [stories, setStories] = useState<Story[] | null>(null);
  const [mine, setMine] = useState<Set<string> | null>(null);
  const [view, setView] = useState<"league" | "mine">("league");
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      // The wire, the roster and the watchlist together: the first is shared
      // and cached, the other two are this manager's, and the band needs all
      // three before it can say which stories are about them.
      const [wire, lineup, watching] = await Promise.all([
        fetch("/api/news").then((r) => (r.ok ? r.json() : { stories: [] })),
        fetch("/api/lineup", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch("/api/watchlist", { cache: "no-store" })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
      ]);

      setStories(wire.stories ?? []);
      setMine(
        new Set([
          ...((lineup?.assignments ?? []) as { playerName: string }[]).map((a) => a.playerName),
          ...((watching?.players ?? []) as string[]),
        ]),
      );
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    // Sets state only once the requests resolve, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const forMe = useMemo(() => {
    if (!stories || !mine) return [];
    return stories.filter((s) => s.players.some((p) => mine.has(p)));
  }, [stories, mine]);

  if (failed) {
    return (
      <div style={{ ...card, padding: "14px 18px", fontSize: 12.5, color: "#9397ab" }}>
        Could not reach the wire just now.
      </div>
    );
  }

  if (!stories) {
    return <div style={{ fontSize: 12, color: "#75798c" }}>Reading the wire…</div>;
  }

  const shown = (view === "mine" ? forMe : stories).slice(0, limit);

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          marginBottom: 10,
        }}
      >
        <div style={{ display: "flex", gap: 4 }}>
          <button onClick={() => setView("league")} style={tab(view === "league")}>
            League news
          </button>
          <button onClick={() => setView("mine")} style={tab(view === "mine")}>
            Player news{forMe.length ? ` · ${forMe.length}` : ""}
          </button>
        </div>
        <span style={{ fontSize: 11, color: "#75798c" }}>
          {view === "mine"
            ? "Your roster, and anyone you are watching."
            : "Everything on the wire."}
        </span>
      </div>

      <div style={card}>
        <NewsWire
          stories={shown}
          highlight={mine ?? undefined}
          emptyMessage={
            view === "mine"
              ? "Nothing about your players right now. Watch a free agent to hear about him before you claim him."
              : undefined
          }
        />
      </div>

      <div style={{ marginTop: 10, fontSize: 11, display: "flex", gap: 14, flexWrap: "wrap" }}>
        <Link
          href={view === "mine" ? "/news?view=players" : "/news"}
          style={{
            color: "#b5abfc",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            minHeight: 34,
          }}
        >
          The whole wire →
        </Link>
        {view === "mine" ? (
          <Link
            href="/free-agents"
            style={{
              color: "#75798c",
              textDecoration: "none",
              display: "inline-flex",
              alignItems: "center",
              minHeight: 34,
            }}
          >
            Watch a player →
          </Link>
        ) : null}
      </div>
    </>
  );
}
