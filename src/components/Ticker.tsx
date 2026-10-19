"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { seasonPlayers, topScorers, valueBoard } from "@/lib/league-story";
import { useRefreshable } from "@/lib/use-refresh";
import { gameLabel, useNflGames } from "@/lib/use-nfl-games";
import { ink, tint } from "./RowList";

interface Item {
  a: string;
  b: string;
  c?: string;
  live: boolean;
}

/** How long each General Manager strip stays before the other takes over. */
const CYCLE_MS = 14_000;

/**
 * The strip under the header. The League scrolls this week's NFL scores; the
 * General Manager tab alternates the league's ten best values against their
 * draft slot with its ten top scorers, every fourteen seconds. Rankings has no
 * ticker. From prototype/Pylon App.dc.html.
 */
export default function Ticker({ kind }: { kind: "league" | "gm" }) {
  return kind === "league" ? <ScoresTicker /> : <ManagerTicker />;
}

function ScoresTicker() {
  const { games, week } = useNflGames();

  const items = useMemo<Item[]>(
    () =>
      (games ?? [])
        .filter((g) => g.home && g.away)
        .map((g) => {
          const live = g.state === "in";
          const started = g.state !== "pre";
          const a = started
            ? `${g.away!.abbrev} ${g.away!.score}  ${g.home!.abbrev} ${g.home!.score}`
            : `${g.away!.abbrev} at ${g.home!.abbrev}`;
          const b = gameLabel(g);
          return { a, b, live };
        }),
    [games],
  );

  if (!items.length) return null;
  return <Strip label={week ? `NFL WK ${week}` : "NFL"} items={items} />;
}

function ManagerTicker() {
  const [players, setPlayers] = useState<ReturnType<typeof seasonPlayers>>([]);
  const [mode, setMode] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/rankings", { cache: "no-store" });
      if (!res.ok) return;
      const body = await res.json();
      if (body?.points) setPlayers(seasonPlayers(body.points, body.rostered ?? {}));
    } catch {
      // As above.
    }
  }, []);

  useRefreshable(load);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(() => setMode((m) => (m + 1) % 2), CYCLE_MS);
    return () => clearInterval(t);
  }, [load]);

  const value = useMemo(() => valueBoard(players, 10), [players]);
  const mvp = useMemo(() => topScorers(players, 10), [players]);

  const showValue = mode === 0 && value.length > 0;
  const items: Item[] = showValue
    ? value.map((v, i) => ({
        a: `${i + 1}. ${v.player.name}`,
        b: `${v.player.pos}${v.player.preRank} → ${v.player.pos}${v.now}`,
        c: v.gain > 0 ? `▲${v.gain}` : v.gain < 0 ? `▼${-v.gain}` : "—",
        live: i === 0,
      }))
    : mvp.map((p, i) => ({
        a: `${i + 1}. ${p.name}`,
        b: [p.pos, p.team].filter(Boolean).join(" · "),
        c: p.points.toFixed(1),
        live: i === 0,
      }));

  if (!items.length) return null;
  // Keyed so the marquee starts from the left when the strip changes over.
  return <Strip key={showValue ? "value" : "mvp"} label={showValue ? "BEST VALUE" : "MVP"} items={items} />;
}

function Strip({ label, items }: { label: string; items: Item[] }) {
  // Twice over, so the marquee can loop seamlessly by sliding exactly half.
  const doubled = items.concat(items);
  return (
    <div
      className="gl-ticker"
      role="marquee"
      aria-label={`${label}: ${items.map((i) => [i.a, i.b, i.c].filter(Boolean).join(" ")).join("; ")}`}
      style={{
        display: "flex",
        alignItems: "center",
        margin: "6px 0 0",
        borderRadius: 4,
        overflow: "hidden",
        background: ink(3),
        border: `1px solid ${ink(7)}`,
      }}
    >
      <span
        style={{
          flex: "0 0 auto",
          fontSize: 9,
          fontWeight: 500,
          letterSpacing: ".16em",
          padding: "5px 8px",
          color: "var(--ap-a100)",
          background: tint(22),
          fontStyle: "italic",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <div aria-hidden style={{ flex: 1, minWidth: 0, overflow: "hidden", position: "relative", padding: "5px 0" }}>
        <div className="gl-ticker-track" style={{ display: "flex", width: "max-content" }}>
          {doubled.map((t, i) => (
            <span
              key={i}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 14px", whiteSpace: "pre", fontSize: 10.5 }}
            >
              <span
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  flex: "0 0 auto",
                  background: t.live ? "var(--ap-a300)" : "var(--ap-n600)",
                  boxShadow: t.live ? "0 0 6px var(--ap-accent)" : undefined,
                }}
              />
              <span style={{ color: "var(--text)" }}>{t.a}</span>
              <span style={{ color: t.live ? "var(--ap-a300)" : "var(--ap-n400)" }}>{t.b}</span>
              {t.c ? <span style={{ color: "var(--ap-n500)" }}>{t.c}</span> : null}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
