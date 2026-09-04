"use client";

import { headshot } from "@/data/league-data";
import PlayerName from "./PlayerName";
import type { Home } from "@/lib/home-types";

/**
 * The league at a glance: who is scoring at each position, and who is actually
 * any good.
 *
 * The rankings are deliberately not the standings — the standings are on the
 * League page and settle only when a week is graded. This blends record with
 * points scored, so a team winning by three points a week and a team winning
 * by forty do not look identical.
 */

const BLANK = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const panel: React.CSSProperties = {
  border: "1px solid rgb(var(--accent-rgb) / .22)",
  borderRadius: "var(--radius-lg)",
  background: "rgb(var(--surface-rgb) / .55)",
  overflow: "hidden",
};

const panelHead: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: 8,
  padding: "12px 15px 10px",
  borderBottom: "1px solid rgb(var(--accent-rgb) / .14)",
  fontSize: 10,
  letterSpacing: ".2em",
  color: "var(--accent-link)",
};

export default function LeagueOverview({ home }: { home: Home }) {
  const { leaders, leaderBasis, power, played } = home;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(min(320px,100%),1fr))",
        gap: 12,
        alignItems: "start",
      }}
    >
      {/* ------------------------------------------------ top of each position */}
      <div style={panel}>
        <div style={panelHead}>
          TOP OF EACH POSITION
          <span style={{ marginLeft: "auto", letterSpacing: ".14em", color: "var(--text-dim)" }}>
            {leaderBasis === "scored" ? "SEASON POINTS" : "PROJECTED"}
          </span>
        </div>

        {leaders.every((l) => !l.player) ? (
          <div style={{ padding: "16px 15px", fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
            Nobody holds a player yet. This fills in once the draft has run.
          </div>
        ) : (
          leaders.map((l, i) => (
            <div
              key={l.position}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "9px 15px",
                borderTop: i === 0 ? "none" : "1px solid rgb(var(--accent-rgb) / .1)",
              }}
            >
              <div
                style={{
                  flex: "0 0 auto",
                  width: 40,
                  textAlign: "center",
                  fontFamily: "var(--font-heading)",
                  fontSize: 10,
                  letterSpacing: ".1em",
                  color: "var(--accent-link)",
                  background: "rgb(var(--accent-rgb) / .12)",
                  borderRadius: "var(--radius-sm)",
                  padding: "5px 0",
                }}
              >
                {l.position === "D/ST" ? "DST" : l.position}
              </div>

              {l.player ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={headshot(l.player.name) || BLANK}
                    alt=""
                    width={28}
                    height={28}
                    style={{
                      flex: "0 0 auto",
                      borderRadius: "50%",
                      objectFit: "contain",
                      border: "1px solid rgb(var(--accent-rgb) / .3)",
                      background: "rgb(var(--raised-rgb) / .7)",
                    }}
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, color: "var(--text)", minWidth: 0 }}>
                      <PlayerName name={l.player.name} />
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        color: "var(--text-dim)",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {l.player.team}
                      {l.player.franchise ? ` · ${l.player.franchise}` : " · free agent"}
                    </div>
                  </div>
                  <div
                    style={{
                      flex: "0 0 auto",
                      fontFamily: "var(--font-heading)",
                      fontSize: 16,
                      color: "var(--accent-text)",
                    }}
                  >
                    {l.player.points.toFixed(1)}
                  </div>
                </>
              ) : (
                <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Nobody holds one</div>
              )}
            </div>
          ))
        )}
      </div>

      {/* -------------------------------------------------------- power rankings */}
      <div style={panel}>
        <div style={panelHead}>
          POWER RANKINGS
          <span style={{ marginLeft: "auto", letterSpacing: ".14em", color: "var(--text-dim)" }}>
            {played ? "RECORD + POINTS" : "POINTS ONLY"}
          </span>
        </div>

        {power.map((t, i) => (
          <div
            key={t.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "9px 15px",
              borderTop: i === 0 ? "none" : "1px solid rgb(var(--accent-rgb) / .1)",
              background: t.mine ? "rgb(var(--accent-rgb) / .1)" : undefined,
            }}
          >
            <div
              style={{
                flex: "0 0 auto",
                width: 22,
                fontFamily: "var(--font-heading)",
                fontSize: 15,
                color: t.rank <= 3 ? "var(--accent-text)" : "var(--text-dim)",
              }}
            >
              {t.rank}
            </div>

            <div style={{ minWidth: 0, flex: 1 }}>
              <div
                style={{
                  fontSize: 13,
                  color: "var(--text)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {t.franchise}
                {t.mine ? <span style={{ color: "var(--accent-link)", fontSize: 10 }}> · YOU</span> : null}
              </div>
              <div style={{ fontSize: 10, color: "var(--text-dim)" }}>
                {played ? `${t.wins}-${t.losses}${t.ties ? `-${t.ties}` : ""} · ` : ""}
                {t.pointsFor.toFixed(1)} PF
              </div>
            </div>

            {/* The rating as a bar as well as a number: twelve numbers in a
                column are hard to compare, twelve bars are not. */}
            <div style={{ flex: "0 0 auto", width: 76 }}>
              <div
                style={{
                  height: 5,
                  borderRadius: 3,
                  background: "rgb(var(--accent-rgb) / .16)",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${Math.max(2, t.rating)}%`,
                    height: "100%",
                    background: "linear-gradient(90deg,var(--accent-deep),var(--accent-link))",
                  }}
                />
              </div>
              <div style={{ fontSize: 10, color: "var(--text-dim)", textAlign: "right", marginTop: 3 }}>
                {t.rating.toFixed(1)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
