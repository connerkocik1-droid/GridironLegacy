"use client";

import { useMemo } from "react";

/**
 * The best still on the table, sliding across the top of the board.
 *
 * The board answers "who has been taken"; on its own it leaves you switching
 * back to the player list to remember who is left, which is the one thing you
 * want to know while you wait for your pick. This puts that answer above the
 * board without taking the board off the screen.
 *
 * It is live in the sense that matters: the list behind it is refetched with
 * everything else, so a player leaves the strip the moment somebody takes him.
 */

interface Available {
  name: string;
  position: string;
  team: string;
  adp: number;
  posRank: string;
  bye: number;
}

// The same tints the board uses, so a position means the same colour in both.
const TINT: Record<string, string> = {
  QB: "#e5a3a3",
  RB: "#8fd3b0",
  WR: "#a8b8e8",
  TE: "#e0bb84",
  K: "#b0a8cc",
  "D/ST": "#a8a8bb",
};

/**
 * How many players ride the strip.
 *
 * Enough that it does not repeat while you watch, few enough that the loop
 * comes round before you have given up on it. It is also what keeps the
 * animation steady: the duration is set from this rather than from how many
 * players happen to be left, so the strip does not speed up as the pool drains.
 */
const RIDING = 30;

/** Seconds each player takes to cross, which sets the pace of the whole strip. */
const SECONDS_EACH = 2.6;

export default function DraftTicker({ available }: { available: Available[] }) {
  const riding = useMemo(() => available.slice(0, RIDING), [available]);

  if (!riding.length) return null;

  return (
    <div
      className="gl-ticker"
      style={{
        display: "flex",
        alignItems: "stretch",
        borderBottom: "1px solid rgba(145,132,217,.18)",
        background: "rgba(20,22,35,.5)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "0 13px",
          flex: "0 0 auto",
          borderRight: "1px solid rgba(145,132,217,.18)",
          background: "rgba(26,28,43,.9)",
          zIndex: 1,
        }}
      >
        <span
          aria-hidden
          style={{
            width: 5,
            height: 5,
            borderRadius: "50%",
            background: "#7fd1a8",
            animation: "mt-pulse 1.6s ease infinite",
          }}
        />
        <span style={{ fontSize: 8.5, letterSpacing: ".18em", color: "#9397ab", whiteSpace: "nowrap" }}>
          BEST AVAILABLE
        </span>
        <span
          style={{
            fontSize: 8.5,
            letterSpacing: ".12em",
            color: "#75798c",
            whiteSpace: "nowrap",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {available.length}
          {available.length >= 200 ? "+" : ""} LEFT
        </span>
      </div>

      {/* The rail clips the track; the track is what moves. */}
      <div className="gl-ticker-rail" style={{ flex: 1, minWidth: 0 }}>
        <div
          className="gl-ticker-track"
          style={{
            display: "flex",
            width: "max-content",
            animationDuration: `${riding.length * SECONDS_EACH}s`,
          }}
        >
          {/* Twice, so the second copy is already in place as the first leaves.
              The copy is hidden from screen readers, which should hear the
              list once. */}
          {[0, 1].map((copy) => (
            <div key={copy} aria-hidden={copy === 1} style={{ display: "flex" }}>
              {riding.map((p, i) => (
                <span
                  key={p.name}
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 6,
                    padding: "7px 15px",
                    whiteSpace: "nowrap",
                    fontSize: 11,
                    borderRight: "1px solid rgba(145,132,217,.08)",
                  }}
                >
                  <span
                    style={{
                      fontSize: 8.5,
                      color: "#5d6070",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {i + 1}
                  </span>
                  <span style={{ color: i === 0 ? "#e9e9ed" : "#c9cbd8" }}>{p.name}</span>
                  <span style={{ fontSize: 9, letterSpacing: ".08em", color: TINT[p.position] ?? "#9397ab" }}>
                    {p.posRank || (p.position === "D/ST" ? "DST" : p.position)}
                  </span>
                  <span style={{ fontSize: 9, letterSpacing: ".08em", color: "#5d6070" }}>
                    {p.team}
                    {p.bye ? ` · BYE ${p.bye}` : ""}
                  </span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
