"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { seasonPlayers } from "@/lib/league-story";
import { useMe } from "@/lib/use-me";
import { useRefreshable } from "@/lib/use-refresh";
import { openPlayer } from "@/lib/player-sheet";
import { AppView, Chips, Foot, GroupSkeleton, Note, RowGroup } from "./RowList";

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "D/ST"] as const;
type Pos = (typeof POSITIONS)[number];

/**
 * Rankings → Players: fantasy rankings by position, ordered by what the
 * league has actually scored each man this season, the top three lit and
 * yours highlighted — with who holds him and where he was drafted. Tap any
 * row for his player sheet. From the Players view in
 * prototype/Pylon App.dc.html.
 */
export default function PlayersView() {
  const me = useMe();
  const [pos, setPos] = useState<Pos>("QB");
  const [ranks, setRanks] = useState<{ points: Record<string, { total: number; games: number }>; rostered: Record<string, string> } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/rankings", { cache: "no-store" });
      if (!res.ok) throw new Error(String(res.status));
      const body = await res.json();
      setRanks({ points: body.points ?? {}, rostered: body.rostered ?? {} });
      setError(null);
    } catch {
      setError("Could not read the season's scoring.");
    }
  }, []);

  useRefreshable(load);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const players = useMemo(() => (ranks ? seasonPlayers(ranks.points, ranks.rostered) : []), [ranks]);
  const mine = me.manager?.franchise ?? null;

  if (error && !ranks) {
    return (
      <AppView>
        <Note tag="PLAYERS" tone="warn">{error}</Note>
      </AppView>
    );
  }

  const list = players.filter((p) => p.pos === pos).sort((a, b) => b.points - a.points);

  return (
    <AppView>
      <Chips options={[...POSITIONS]} value={pos} onChange={setPos} label="Position" />
      {!ranks ? (
        <GroupSkeleton rows={10} />
      ) : (
        <RowGroup
          label={`${pos} · SEASON POINTS`}
          note={`${list.length} players`}
          limit={25}
          rows={list.map((p, i) => {
            const yours = mine != null && p.franchise === mine;
            return {
              key: p.name,
              num: i + 1,
              lit: i < 3,
              hi: yours,
              tile: p.team || p.pos,
              tileTone: yours ? "me" : undefined,
              title: p.name,
              sub: [p.franchise ?? "Free agent", p.preRank ? `drafted ${p.pos}${p.preRank}` : null].filter(Boolean).join(" · "),
              val: p.points.toFixed(1),
              valSub: p.games ? `${(p.points / p.games).toFixed(1)} PG` : undefined,
              bigVal: true,
              valColor: "var(--ap-a200)",
              onClick: () => openPlayer(p.name),
            };
          })}
          empty={{ title: "Nobody has scored here yet", sub: "Rankings fill in once a week has been played." }}
        />
      )}
      <Foot>Points are what this league has awarded this season.</Foot>
    </AppView>
  );
}
