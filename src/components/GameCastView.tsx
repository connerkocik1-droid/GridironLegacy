"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { player } from "@/lib/roster";
import { useRefreshable } from "@/lib/use-refresh";
import { gameLabel, useNflGames } from "@/lib/use-nfl-games";
import { useRetro } from "@/lib/retro";
import { spriteFor } from "@/lib/team-logo";
import TeamMark from "./TeamMark";
import { AppView, Foot, GroupSkeleton, RowGroup, type RowSpec } from "./RowList";

/**
 * The League → GameCast: this week's NFL games as one list — score, status,
 * who is ahead, and which of your players are in it. Pressing one opens its
 * gamecast: the drive, the plays, the box score. From the GameCast view in
 * prototype/Pylon App.dc.html. In sixteen-bit mode each row runs a sprite in
 * the leading club's colours.
 */
export default function GameCastView() {
  const { games, week } = useNflGames();
  const retro = useRetro();
  const [roster, setRoster] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/lineup", { cache: "no-store" });
      if (res.ok) setRoster(((await res.json()).roster ?? []) as string[]);
    } catch {
      // Without a roster the list is still the slate.
    } finally {
      setLoaded(true);
    }
  }, []);

  useRefreshable(load);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const mineByTeam = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const name of roster) {
      const t = player(name)?.t;
      if (!t) continue;
      const key = t === "WAS" ? "WSH" : t;
      out.set(key, [...(out.get(key) ?? []), surname(name)]);
    }
    return out;
  }, [roster]);

  if (!games.length && !loaded) {
    return (
      <AppView>
        <GroupSkeleton rows={8} />
      </AppView>
    );
  }

  const ordered = [...games]
    .filter((g) => g.home && g.away)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const live = ordered.filter((g) => g.state === "in").length;

  const rows: RowSpec[] = ordered.map((g) => {
    const away = g.away!;
    const home = g.home!;
    const started = g.state !== "pre";
    const leader = away.score > home.score ? away.abbrev : home.score > away.score ? home.abbrev : null;
    const yours = [...(mineByTeam.get(away.abbrev) ?? []), ...(mineByTeam.get(home.abbrev) ?? [])];
    return {
      key: g.id,
      hi: yours.length > 0,
      logo: retro ? (
        <span aria-hidden className="gl-px-sprite" style={{ backgroundImage: spriteFor(leader ?? away.abbrev) }} />
      ) : (
        // Both clubs, away over home, as the title reads.
        <span aria-hidden style={{ display: "inline-flex", alignItems: "center", gap: 2, minWidth: 46 }}>
          <TeamMark team={away.abbrev} size={22} opacity={1} />
          <TeamMark team={home.abbrev} size={22} opacity={1} />
        </span>
      ),
      title: started ? `${away.abbrev} ${away.score} · ${home.abbrev} ${home.score}` : `${away.abbrev} at ${home.abbrev}`,
      tags: g.state === "in" ? [{ label: "LIVE", tone: "live" }] : g.state === "post" ? [{ label: "FINAL", tone: "flat" }] : [],
      sub: `${gameLabel(g)}${yours.length ? ` · yours: ${yours.join(", ")}` : ""}`,
      val: started ? (leader ?? "TIE") : undefined,
      valSub: started ? (g.state === "post" ? (leader ? "WON" : "") : leader ? "LEADS" : "") : undefined,
      href: `/game/${g.id}`,
    };
  });

  return (
    <AppView>
      <RowGroup
        label={week ? `NFL WEEK ${week}` : "NFL"}
        note={live ? `${live} live` : `${ordered.length} games`}
        rows={rows}
        empty={{ title: "No games this week", sub: "The slate appears once the NFL publishes it." }}
      />
      <Foot>Tap a game for the drive, the play-by-play and the box score.</Foot>
    </AppView>
  );
}

/** "James Cook III" → "Cook"; "Seahawks D/ST" → "Seahawks D/ST". */
function surname(name: string): string {
  if (/D\/ST$/.test(name)) return name.replace(/\s*D\/ST$/, " D/ST");
  const words = name.split(" ").filter((w) => !/^(jr\.?|sr\.?|ii|iii|iv|v)$/i.test(w));
  return words[words.length - 1] ?? name;
}
