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
            color: leading ? "#e9e9ed" : "#9397ab",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {side.franchise}
        </div>
        <div style={{ fontSize: 9, letterSpacing: ".14em", color: "#75798c", marginTop: 2 }}>
          {side.slot}
        </div>
      </div>
      <div
        style={{
          marginLeft: right ? 0 : "auto",
          marginRight: right ? "auto" : 0,
          fontFamily: "var(--font-heading)",
          fontSize: 19,
          color: leading ? "#d2cefd" : "#b2b6ca",
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
          border: "1px solid rgba(145,132,217,.22)",
          borderRadius: "var(--radius-lg)",
          background: "rgba(26,28,43,.55)",
          padding: "18px 20px",
          fontSize: 12.5,
          color: "#9397ab",
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
          gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))",
          gap: 9,
        }}
      >
        {games.map((g) => (
          <div
            key={`${g.home.id}-${g.away.id}`}
            role="group"
            aria-label={`${g.home.franchise} versus ${g.away.franchise}${g.mine ? ", your game" : ""}`}
            style={{
              border: `1px solid ${g.mine ? "rgba(181,171,252,.55)" : "rgba(145,132,217,.2)"}`,
              borderRadius: "var(--radius-md)",
              background: g.mine ? "rgba(145,132,217,.12)" : "rgba(26,28,43,.55)",
              padding: "12px 14px 13px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontSize: 8.5,
                letterSpacing: ".18em",
                color: g.mine ? "#b5abfc" : "#75798c",
                marginBottom: 9,
              }}
            >
              {g.mine ? "YOUR GAME" : "FIXTURE"}
              <span style={{ marginLeft: "auto", color: "#75798c" }}>
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
        <div style={{ fontSize: 11, color: "#75798c", marginTop: 10 }}>
          Bye this week: {byes.map((b) => b.franchise).join(", ")}
        </div>
      ) : null}
    </>
  );
}
