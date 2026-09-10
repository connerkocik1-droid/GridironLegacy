"use client";

import { useMemo } from "react";
import { leagueNews, type PlayerSeason, type Standing } from "@/lib/league-story";

/**
 * The league's own news, as opposed to the NFL's.
 *
 * /news is the wire — ESPN, about real football. This is about the twelve
 * people in this league, and none of it is written by anybody: the highest
 * week, the biggest riser, the longest run, the points-for leader and anybody
 * still looking for a first win are all read off the table.
 *
 * Which means it is empty in September, and says so rather than inventing
 * five headlines about a season that has not started.
 */
export default function LeagueNewsWire({
  rows,
  players,
  weeks,
}: {
  rows: Standing[];
  players: PlayerSeason[];
  weeks: number;
}) {
  const items = useMemo(() => leagueNews(rows, players, weeks), [rows, players, weeks]);

  if (!items.length) {
    return (
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.65 }}>
        Nothing to report yet. Once a week has been graded this fills with the highest score,
        the biggest riser against the draft, and whoever is running hot — all of it read off
        the table rather than written by anybody.
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 10 }}>
      {items.map((n) => {
        const cold = n.tone === "cold";
        return (
          <article
            key={n.tag + n.head}
            style={{
              border: `1px solid ${cold ? "rgb(var(--warn-rgb) / .3)" : "rgb(var(--accent-rgb) / .2)"}`,
              borderRadius: "var(--radius-lg)",
              background: "rgb(var(--surface-rgb) / .55)",
              padding: "13px 14px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 7 }}>
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: ".14em",
                  padding: "2px 7px",
                  borderRadius: 3,
                  border: `1px solid ${cold ? "rgb(var(--warn-rgb) / .5)" : "rgb(var(--accent-bright-rgb) / .5)"}`,
                  color: cold ? "var(--warn)" : "var(--accent-link)",
                  flex: "0 0 auto",
                }}
              >
                {n.tag}
              </span>
              <span style={{ fontSize: 10, letterSpacing: ".12em", color: "var(--text-dim)" }}>
                LEAGUE OFFICE
              </span>
            </div>

            <h3
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 15,
                fontWeight: 500,
                margin: 0,
                lineHeight: 1.35,
                color: "var(--text)",
              }}
            >
              {n.head}
            </h3>
            <p
              style={{
                fontSize: 12.5,
                color: "var(--text-muted)",
                lineHeight: 1.6,
                margin: "5px 0 0",
              }}
            >
              {n.body}
            </p>
          </article>
        );
      })}
    </div>
  );
}
