"use client";

import type { HomeSide, HomeGame } from "@/lib/home-types";

/**
 * Every fixture in the league this week, on one board.
 *
 * The manager's own game is marked but not moved: seeing your row in its place
 * among the others is the point of a scoreboard, and the full head-to-head is
 * directly beneath it anyway.
 */

function Row({ side, leading, align }: { side: HomeSide; leading: boolean; align: "left" | "right" }) {
  const right = align === "right";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: right ? "row-reverse" : "row",
        alignItems: "baseline",
        gap: 10,
        minWidth: 0,
      }}
    >
      <div style={{ minWidth: 0, textAlign: right ? "right" : "left" }}>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 14,
            color: leading ? "var(--text)" : "var(--text-muted)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {side.franchise}
        </div>
        <div style={{ fontSize: 10, letterSpacing: ".14em", color: "var(--text-dim)", marginTop: 2 }}>
          {side.slot}
        </div>
      </div>
      <div
        style={{
          marginLeft: right ? 0 : "auto",
          marginRight: right ? "auto" : 0,
          fontFamily: "var(--font-heading)",
          fontSize: 19,
          color: leading ? "var(--accent-text)" : "var(--text-3)",
        }}
      >
        {side.total.toFixed(1)}
      </div>
    </div>
  );
}

export default function WeekScoreboard({
  games,
  byes,
  live,
}: {
  games: HomeGame[];
  byes: { slot: string; franchise: string }[];
  live: boolean;
}) {
  if (!games.length) {
    return (
      <div
        style={{
          border: "1px solid rgb(var(--accent-rgb) / .22)",
          borderRadius: "var(--radius-lg)",
          background: "rgb(var(--surface-rgb) / .55)",
          padding: "18px 20px",
          fontSize: 12.5,
          color: "var(--text-muted)",
          lineHeight: 1.6,
        }}
      >
        No fixtures yet. The commissioner builds the schedule once every
        franchise is claimed.
      </div>
    );
  }

  return (
    <>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill,minmax(min(300px,100%),1fr))",
          gap: 9,
        }}
      >
        {games.map((g) => (
          <div
            key={`${g.home.id}-${g.away.id}`}
            role="group"
            aria-label={`${g.home.franchise} versus ${g.away.franchise}${g.mine ? ", your game" : ""}`}
            style={{
              border: `1px solid ${g.mine ? "rgb(var(--accent-bright-rgb) / .55)" : "rgb(var(--accent-rgb) / .2)"}`,
              borderRadius: "var(--radius-md)",
              background: g.mine ? "rgb(var(--accent-rgb) / .12)" : "rgb(var(--surface-rgb) / .55)",
              padding: "12px 14px 13px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 10,
                letterSpacing: ".18em",
                color: g.mine ? "var(--accent-link)" : "var(--text-dim)",
                marginBottom: 9,
              }}
            >
              {g.mine ? "YOUR GAME" : "FIXTURE"}
              <span style={{ marginLeft: "auto", color: "var(--text-dim)" }}>
                {g.final ? "FINAL" : live ? "LIVE" : "PROJECTED"}
              </span>
            </div>

            <div style={{ display: "grid", gap: 8 }}>
              <Row side={g.home} leading={g.home.total >= g.away.total} align="left" />
              <Row side={g.away} leading={g.away.total >= g.home.total} align="left" />
            </div>
          </div>
        ))}
      </div>

      {byes.length ? (
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 10 }}>
          Bye this week: {byes.map((b) => b.franchise).join(", ")}
        </div>
      ) : null}
    </>
  );
}
