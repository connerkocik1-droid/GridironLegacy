"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import NewsWire from "./NewsWire";
import type { Story } from "@/lib/news";

/**
 * The NFL's news, inside the league.
 *
 * /news has rendered this since the beginning and nothing in the app has ever
 * linked to it — no nav item, no door, no tab — so a whole feature sat there
 * unreachable. It belongs beside the league's own news rather than on a page
 * of its own: a manager asking "what has happened" means both, and one of the
 * two answers being a page nobody can find is the same as not having it.
 *
 * Yours first. The wire is forty stories about the whole league and about
 * thirty of them are about players nobody here holds; a manager wants the
 * three that are about his own.
 */
export default function LeagueWire({ roster }: { roster: string[] }) {
  const [stories, setStories] = useState<Story[] | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/news", { cache: "no-store" });
      if (!res.ok) return setFailed(true);
      const body = await res.json();
      // 200 with ok:false is ESPN being unreachable, not a quiet week.
      if (body.ok === false) setFailed(true);
      setStories(Array.isArray(body.stories) ? body.stories : []);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const mine = useMemo(() => new Set(roster), [roster]);

  // Stories about somebody on this roster, then everything else, and only the
  // first few of each — the whole wire is a page of its own, linked below.
  const ordered = useMemo(() => {
    if (!stories) return [];
    const about = stories.filter((s) => s.players.some((p) => mine.has(p)));
    const rest = stories.filter((s) => !s.players.some((p) => mine.has(p)));
    return [...about.slice(0, 4), ...rest.slice(0, Math.max(2, 6 - about.length))];
  }, [stories, mine]);

  if (stories === null && !failed) {
    return (
      <div style={{ fontSize: 12.5, color: "var(--text-dim)", padding: "10px 0" }}>
        Reading the wire…
      </div>
    );
  }

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 8,
        }}
      >
        <div style={{ fontSize: 10, letterSpacing: ".24em", color: "var(--text-dim)" }}>
          AROUND THE NFL
        </div>
        <Link
          href="/news"
          style={{
            fontSize: 11,
            color: "var(--accent-link)",
            textDecoration: "none",
            padding: "6px 0",
            margin: "-6px 0",
          }}
        >
          The whole wire →
        </Link>
      </div>

      <div
        data-wire="nfl"
        style={{
          border: "1px solid rgb(var(--accent-rgb) / .18)",
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          background: "rgb(var(--surface-rgb) / .5)",
        }}
      >
        {/* The roster is what turns forty stories into the three that matter,
            so a story about one of your own is marked rather than merely
            present. */}
        <NewsWire
          stories={ordered}
          highlight={mine}
          emptyMessage={
            failed
              ? "The wire is not reachable right now. It refreshes every fifteen minutes."
              : "The wire is quiet. It refreshes every fifteen minutes."
          }
        />
      </div>
    </div>
  );
}
