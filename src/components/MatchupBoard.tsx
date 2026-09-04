"use client";

import { useCallback, useEffect, useState } from "react";
import LiveNumber from "./LiveNumber";
import { headshot, logo } from "@/data/league-data";
import PlayerName from "./PlayerName";
import type { MatchupRow, SideEntry } from "@/lib/matchup";

interface Side {
  id: string;
  slot: string;
  franchise: string;
  total: number;
}

interface Board {
  week: number;
  home: Side;
  away: Side;
  rows: MatchupRow[];
  /** A game on the slate is in progress this second. */
  live: boolean;
  /** Anything on the slate has kicked off, so these are results not guesses. */
  started: boolean;
  /** The week is settled: this arrangement is the one that was recorded. */
  final: boolean;
  managers: { id: string; slot: string; franchise: string }[];
}

const BLANK =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/**
 * One player in one half of a row. `align` flips the layout so the two sides
 * mirror each other around the slot label in the middle.
 */
function PlayerCell({
  entry,
  align,
  leading,
}: {
  entry: SideEntry | null;
  align: "left" | "right";
  leading: boolean;
}) {
  const reverse = align === "right";

  if (!entry) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: reverse ? "flex-end" : "flex-start",
          minWidth: 0,
          color: "#5a5d6e",
          fontSize: 12,
          padding: "0 4px",
        }}
      >
        Empty
      </div>
    );
  }

  return (
    <div
      className="gl-mcell"
      style={{
        display: "flex",
        flexDirection: reverse ? "row-reverse" : "row",
        alignItems: "center",
        // The stat line claims a whole line of its own below (flexBasis 100%),
        // so the name and the score share the first one. A quarterback's line
        // is six parts long and these columns are half a phone wide; sitting it
        // beside the name would leave the name about two letters.
        flexWrap: "wrap",
        rowGap: 2,
        gap: 10,
        minWidth: 0,
        padding: "0 4px",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        className="gl-mcell-face"
        src={headshot(entry.name) || BLANK}
        alt=""
        width={32}
        height={32}
        style={{
          borderRadius: "50%",
          objectFit: "contain",
          border: "1px solid rgba(145,132,217,.3)",
          background: "rgba(35,37,50,.7)",
          flex: "0 0 auto",
        }}
      />

      <div
        className="gl-mcell-name"
        style={{
          minWidth: 0,
          flex: 1,
          display: "flex",
          flexDirection: reverse ? "row-reverse" : "row",
          alignItems: "center",
          gap: 6,
        }}
      >
        <span style={{ minWidth: 0 }}>
          <PlayerName
            name={entry.name}
            style={{ fontFamily: "var(--font-heading)", fontSize: 14 }}
          />
        </span>
        {entry.team ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="gl-mcell-team"
            src={logo(entry.team)}
            alt=""
            width={14}
            height={14}
            style={{ objectFit: "contain", opacity: 0.85, flex: "0 0 auto" }}
          />
        ) : null}
      </div>

      <div
        className="gl-mcell-pts"
        style={{ flex: "0 0 auto", textAlign: align === "left" ? "right" : "left", width: 46 }}
      >
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 16,
            color: leading ? "#d2cefd" : "#b2b6ca",
          }}
        >
          <LiveNumber key={entry.name} value={entry.live ? entry.points : entry.projected} />
        </div>
        {!entry.live ? (
          <div style={{ fontSize: 10, letterSpacing: ".14em", color: "#5a5d6e" }}>PROJ</div>
        ) : null}
      </div>

      {/* Wraps rather than clips. These columns are narrow and a quarterback's
          line is five parts long, so an ellipsis would hide exactly the
          touchdowns somebody opened the page to see. */}
      <div
        className="gl-mcell-line"
        style={{
          flexBasis: "100%",
          fontSize: 10,
          color: "#75798c",
          lineHeight: 1.45,
          overflowWrap: "anywhere",
          textAlign: align,
        }}
      >
        {entry.statLine || `${entry.position}${entry.team ? ` · ${entry.team}` : ""}`}
      </div>
    </div>
  );
}

export default function MatchupBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [opponent, setOpponent] = useState("");

  const load = useCallback(async () => {
    try {
      const query = opponent ? `?opponent=${encodeURIComponent(opponent)}` : "";
      const res = await fetch(`/api/matchup${query}`, { cache: "no-store" });
      if (res.status === 401) return setError("Sign in to see your matchup.");
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error ?? "The league database is not configured yet.");
      }
      if (!res.ok) throw new Error(String(res.status));
      setBoard(await res.json());
      setError(null);
    } catch {
      setError("Could not load this week's matchup.");
    }
  }, [opponent]);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  if (error && !board) {
    return <div style={{ padding: "24px 26px", color: "#e0b573" }}>{error}</div>;
  }
  if (!board) {
    return <div style={{ padding: "24px 26px", color: "#75798c" }}>Reading the rosters…</div>;
  }

  const homeLeads = board.home.total > board.away.total;
  const awayLeads = board.away.total > board.home.total;

  return (
    <>
      {/* The two totals face each other across the header, the same axis the
          rows below are built on. */}
      <div
        className="gl-matchup-head"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          alignItems: "center",
          gap: 18,
          padding: "24px 26px 16px",
        }}
      >
        <div>
          <div style={{ fontSize: 10, letterSpacing: ".28em", color: "#75798c" }}>YOU</div>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 22, marginTop: 4 }}>
            {board.home.franchise}
          </div>
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 40,
              color: homeLeads ? "#d2cefd" : "#e9e9ed",
              marginTop: 2,
            }}
          >
            <LiveNumber key={board.home.id} value={board.home.total} />
          </div>
        </div>

        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, letterSpacing: ".28em", color: "#75798c" }}>
            WEEK {board.week}
          </div>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 13, color: "#b5abfc", margin: "6px 0" }}>
            VS
          </div>
          <div style={{ fontSize: 10, letterSpacing: ".14em", color: "#75798c" }}>
            {board.live ? "LIVE" : board.started ? "SCORED" : "PROJECTED"}
          </div>
        </div>

        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, letterSpacing: ".28em", color: "#75798c" }}>OPPONENT</div>
          <select
            value={opponent}
            aria-label="Opponent"
            onChange={(e) => setOpponent(e.target.value)}
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 22,
              marginTop: 4,
              padding: "2px 6px",
              background: "transparent",
              color: "#e9e9ed",
              border: "1px solid transparent",
              borderRadius: "var(--radius-sm)",
              // The native arrow anchors to the control's own right edge, which
              // leaves it stranded when the box is wider than the text.
              appearance: "none",
              textAlign: "right",
              textAlignLast: "right",
              cursor: "pointer",
            }}
          >
            <option value="">{board.away.franchise}</option>
            {board.managers
              .filter((m) => m.id !== board.home.id && m.id !== board.away.id)
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.franchise}
                </option>
              ))}
          </select>
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 40,
              color: awayLeads ? "#d2cefd" : "#e9e9ed",
              marginTop: 2,
            }}
          >
            <LiveNumber key={board.away.id} value={board.away.total} />
          </div>
        </div>
      </div>

      <div
        style={{
          padding: "0 26px 10px",
          fontSize: 11.5,
          color: "#75798c",
          lineHeight: 1.6,
          maxWidth: "70ch",
        }}
      >
        {board.final
          ? "Best ball: these are the players who ended up in each slot when the last game finished. Neither manager chose them."
          : board.started
            ? "Best ball: nobody set these lineups. Each side's highest scorers are filling the slots and will keep swapping until the last game ends."
            : "Best ball: nobody sets a lineup. When the games start, each side's highest scorers will fill these slots by themselves — until then this is a projection."}
      </div>

      {error ? (
        <div style={{ padding: "0 26px 8px", fontSize: 12, color: "#e0b573" }}>{error}</div>
      ) : null}

      <div style={{ padding: "0 26px 40px" }}>
        <div
          style={{
            border: "1px solid rgba(145,132,217,.22)",
            borderRadius: "var(--radius-lg)",
            background: "rgba(26,28,43,.55)",
            overflow: "hidden",
          }}
        >
          {board.rows.map((row, i) => {
            const homePoints = row.home?.points ?? 0;
            const awayPoints = row.away?.points ?? 0;

            return (
              <div
                key={`${row.slot}-${i}`}
                className="gl-matchup-row"
                style={{
                  display: "grid",
                  // One row per slot: my player, the slot label, their player.
                  gridTemplateColumns: "minmax(0,1fr) 62px minmax(0,1fr)",
                  alignItems: "center",
                  gap: 8,
                  padding: "11px 14px",
                  borderTop: i === 0 ? "none" : "1px solid rgba(145,132,217,.12)",
                }}
              >
                <PlayerCell entry={row.home} align="left" leading={homePoints > awayPoints} />

                <div
                  style={{
                    textAlign: "center",
                    fontFamily: "var(--font-heading)",
                    fontSize: 10,
                    letterSpacing: ".14em",
                    color: "#b5abfc",
                    background: "rgba(145,132,217,.12)",
                    borderRadius: "var(--radius-sm)",
                    padding: "5px 0",
                  }}
                >
                  {row.slot === "D/ST" ? "DST" : row.slot}
                </div>

                <PlayerCell entry={row.away} align="right" leading={awayPoints > homePoints} />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
