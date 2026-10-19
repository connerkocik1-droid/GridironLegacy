"use client";

import Link from "next/link";
import { useNflGames } from "@/lib/use-nfl-games";
import { ink } from "./RowList";

/**
 * The way into the mini-games: one glass tile each, in a two-up grid — a
 * kicker, the game's name in the italic display face, a line on what it is,
 * and where the tap takes you. From the Minigames tiles in
 * prototype/Pylon App.dc.html.
 */
export default function MiniGamesStrip() {
  const { games, week } = useNflGames();
  const graded = games.filter((g) => g.state === "post").length;

  const tiles = [
    {
      href: "/minigames?game=pickem",
      kicker: week ? `PICK-'EM · WK ${week}` : "PICK-'EM",
      name: "Pick-'Em",
      line: games.length ? `${games.length} games · ${graded} graded` : "Call every game this week. The league keeps score.",
      cta: "MAKE PICKS →",
    },
    {
      href: "/minigames?game=20-0",
      kicker: "SURVIVOR",
      name: "20-0 Mode",
      line: "Twelve rolls, two sides of the ball, one perfect season.",
      cta: "PLAY →",
    },
    {
      href: "/minigames?game=mock",
      kicker: "PRACTICE",
      name: "Mock Draft",
      line: "Draft night against the machine, as many times as you like.",
      cta: "START →",
    },
  ];

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
      {tiles.map((t) => (
        <Link
          key={t.href}
          href={t.href}
          className="gl-press"
          style={{
            display: "block",
            padding: "11px 11px",
            borderRadius: 6,
            color: "var(--text)",
            textDecoration: "none",
            background: `linear-gradient(160deg,${ink(6)},${ink(1.5)})`,
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: `1px solid ${ink(9)}`,
            boxShadow: `inset 0 1px 0 ${ink(11)}`,
            ["--gl-panel" as string]: 1,
          }}
        >
          <div style={{ fontSize: 10, letterSpacing: ".18em", color: "var(--ap-a300)" }}>{t.kicker}</div>
          <div style={{ fontSize: 17, fontWeight: 500, fontStyle: "italic", letterSpacing: "-.02em", marginTop: 8 }}>{t.name}</div>
          <div style={{ fontSize: 11, color: "var(--ap-n400)", marginTop: 5, lineHeight: 1.45 }}>{t.line}</div>
          <div style={{ fontSize: 10, letterSpacing: ".14em", color: "var(--ap-a200)", marginTop: 12 }}>{t.cta}</div>
        </Link>
      ))}
    </div>
  );
}
