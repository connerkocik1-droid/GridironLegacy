"use client";

import { useCallback, useEffect, useState } from "react";
import type { Story } from "@/lib/news";
import { player } from "@/lib/roster";
import { useRefreshable } from "@/lib/use-refresh";
import { openPlayer } from "@/lib/player-sheet";
import { reloadWatchlist, toggleWatch, useWatchlist } from "@/lib/use-watchlist";
import PlayerFace from "./PlayerFace";
import { AppView, GroupSkeleton, Note, RowGroup, type RowSpec } from "./RowList";

interface Watched {
  name: string;
  owner: { id: string; franchise: string; mine: boolean } | null;
  clearsAt: string | null;
}

/**
 * General Manager → Watchlist: only the players you have starred — on Free
 * Agency rows or in a player's sheet. Who holds each, what he has scored, and
 * whether he is on waivers; tap the star to let him go. Under it, any news on
 * the men you are watching. From the Watchlist view in
 * prototype/Pylon App.dc.html.
 */
export default function WatchlistView() {
  const starred = useWatchlist();
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [watching, setWatching] = useState<Watched[] | null>(null);
  const [stories, setStories] = useState<Story[]>([]);
  const [totals, setTotals] = useState<Record<string, { total: number; games: number }>>({});
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [list, wire, ranks] = await Promise.all([
        fetch("/api/watchlist", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
        fetch("/api/news").then((r) => (r.ok ? r.json() : { stories: [] })).catch(() => ({ stories: [] })),
        fetch("/api/rankings", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      if (!list) return setError("Sign in to keep a watchlist.");
      setWatching(list.watching ?? []);
      setStories(wire.stories ?? []);
      if (ranks?.points) setTotals(ranks.points);
      setError(null);
      void reloadWatchlist();
    } catch {
      setError("Could not read your watchlist.");
    }
  }, []);

  useRefreshable(load);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (error && !watching) {
    return (
      <AppView>
        <Note tag="WATCHLIST" tone="warn">{error}</Note>
      </AppView>
    );
  }
  if (!watching) {
    return (
      <AppView>
        <GroupSkeleton rows={4} label={false} />
      </AppView>
    );
  }

  // Unstarring here takes him off at once, without waiting for a reload.
  const list = watching.filter((w) => !removed.has(w.name) || starred.has(w.name));
  const names = new Set(list.map((w) => w.name));
  const news = stories.filter((s) => s.players.some((p) => names.has(p))).slice(0, 8);

  const rows: RowSpec[] = list.map((w) => {
    const p = player(w.name);
    const pts = totals[w.name]?.total;
    return {
      key: w.name,
      logo: <PlayerFace name={w.name} />,
      title: w.name,
      tags: w.clearsAt ? [{ label: "WAIVERS", tone: "warn" }] : [],
      sub: [p?.p, p?.t, w.owner ? (w.owner.mine ? "Yours" : w.owner.franchise) : "Free agent", pts != null ? `${pts.toFixed(1)} pts` : null]
        .filter(Boolean)
        .join(" · "),
      actions: [{ label: "★", on: true, tone: "quiet", ariaLabel: `Stop watching ${w.name}`, onClick: () => {
            setRemoved((r) => new Set(r).add(w.name));
            void toggleWatch(w.name);
          } }],
      onClick: () => openPlayer(w.name),
    };
  });

  return (
    <AppView>
      {list.length ? (
        <Note tag="TRACKING">
          {list.length} player{list.length === 1 ? "" : "s"}. Adds, drops and waiver claims on any of them reach you as notices.
        </Note>
      ) : (
        <Note tag="EMPTY">Star a player in Free Agency to start watching him.</Note>
      )}
      {rows.length ? <RowGroup rows={rows} /> : null}
      {news.length ? (
        <RowGroup
          label="NEWS ON YOUR LIST"
          note={`${news.length} stor${news.length === 1 ? "y" : "ies"}`}
          rows={news.map((s) => ({
            key: s.id,
            title: s.headline,
            sub: [s.players.filter((p) => names.has(p)).join(", "), new Date(s.published).toLocaleDateString(undefined, { month: "short", day: "numeric" })]
              .filter(Boolean)
              .join(" · "),
            detail: s.description ? [["", s.description]] : undefined,
          }))}
        />
      ) : null}
    </AppView>
  );
}
