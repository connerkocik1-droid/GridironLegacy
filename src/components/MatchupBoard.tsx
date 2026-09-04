"use client";

import { useCallback, useEffect, useState } from "react";
import TeamMark from "./TeamMark";
import Skeleton from "./Skeleton";
import LiveNumber from "./LiveNumber";
import ScoreBar from "./ScoreBar";
import { headshot } from "@/data/league-data";
import PlayerName from "./PlayerName";
import type { MatchupRow, SideEntry } from "@/lib/matchup";

interface Side {
  id: string;
  slot: string;
  franchise: string;
  total: number;
}

/** A week this manager sits out. There is no fixture, so there is no board. */
interface Bye {
  week: number;
  message: string;
  managers: { id: string; slot: string; franchise: string }[];
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
          color: "var(--text-faint)",
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
          border: "1px solid rgb(var(--accent-rgb) / .3)",
          background: "rgb(var(--raised-rgb) / .7)",
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
        <TeamMark team={entry.team} size={14} opacity={0.85} className="gl-mcell-team" />
      </div>

      <div
        className="gl-mcell-pts"
        style={{ flex: "0 0 auto", textAlign: align === "left" ? "right" : "left", width: 46 }}
      >
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 16,
            color: leading ? "var(--accent-text)" : "var(--text-3)",
          }}
        >
          <LiveNumber key={entry.name} value={entry.live ? entry.points : entry.projected} />
        </div>
        {!entry.live ? (
          <div style={{ fontSize: 10, letterSpacing: ".14em", color: "var(--text-faint)" }}>PROJ</div>
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
          color: "var(--text-dim)",
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
  const [bye, setBye] = useState<Bye | null>(null);
  // Who the schedule says you are playing, remembered from the load that had
  // no opponent forced on it. Once one is forced the response stops saying,
  // and without this there is no way back to your own game.
  const [scheduled, setScheduled] = useState<{ id: string; franchise: string } | null>(null);
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

      const body = await res.json();

      // A bye answers 200, because sitting out a week is a fact about the
      // schedule rather than a fault — and it comes back without the two
      // sides, because there are not two sides. This screen used to read
      // `board.home.total` off it and take the whole page down with it: an
      // odd-numbered league gives somebody a bye every single week, and every
      // one of them opened this page to a crash.
      if (!body?.home || !body?.away) {
        setBye({
          week: body?.week ?? 0,
          message: body?.error ?? "There is no fixture for you this week.",
          managers: body?.managers ?? [],
        });
        setBoard(null);
        setError(null);
        return;
      }

      setBye(null);
      setBoard(body);
      if (!opponent) setScheduled({ id: body.away.id, franchise: body.away.franchise });
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
    return <div style={{ padding: "24px 26px", color: "var(--warn)" }}>{error}</div>;
  }
  if (bye) {
    return <ByeWeek bye={bye} onCompare={setOpponent} />;
  }
  if (!board) {
    return <Skeleton rows={5} />;
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
          <div style={{ fontSize: 10, letterSpacing: ".28em", color: "var(--text-dim)" }}>YOU</div>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 22, marginTop: 4 }}>
            {board.home.franchise}
          </div>
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 40,
              color: homeLeads ? "var(--accent-text)" : "var(--text)",
              marginTop: 2,
            }}
          >
            <LiveNumber key={board.home.id} value={board.home.total} />
          </div>
        </div>

        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 10, letterSpacing: ".28em", color: "var(--text-dim)" }}>
            WEEK {board.week}
          </div>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 13, color: "var(--accent-link)", margin: "6px 0" }}>
            VS
          </div>
          <div style={{ fontSize: 10, letterSpacing: ".14em", color: "var(--text-dim)" }}>
            {board.live ? "LIVE" : board.started ? "SCORED" : "PROJECTED"}
          </div>
        </div>

        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, letterSpacing: ".28em", color: "var(--text-dim)" }}>OPPONENT</div>
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
              color: "var(--text)",
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
            {/* The list has to contain whatever is selected, or the control
                renders empty. It used to hold "" for the fixture and then
                every manager except the one on screen — so the moment you
                picked somebody, the value was an id that no option carried
                and the name above the score went blank. The scheduled
                opponent is the "" option; everybody else is themselves; and
                on a bye there is no "" option because there is no fixture. */}
            {(scheduled ? [{ value: "", label: scheduled.franchise }] : []).concat(
              board.managers
                .filter((m) => m.id !== board.home.id && m.id !== scheduled?.id)
                .map((m) => ({ value: m.id, label: m.franchise })),
            ).map((choice) => (
              <option key={choice.value || "scheduled"} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 40,
              color: awayLeads ? "var(--accent-text)" : "var(--text)",
              marginTop: 2,
            }}
          >
            <LiveNumber key={board.away.id} value={board.away.total} />
          </div>
        </div>
      </div>

      {/* The gap, drawn. This is the screen a manager sits on during a game,
          so it is the screen where the distance between the two numbers is
          worth more than either of them. */}
      {board.started ? (
        <div style={{ padding: "0 10px" }}>
          <ScoreBar mine={board.home.total} theirs={board.away.total} final={board.final} />
        </div>
      ) : null}

      <div
        style={{
          padding: "0 26px 10px",
          fontSize: 11.5,
          color: "var(--text-dim)",
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
        <div style={{ padding: "0 26px 8px", fontSize: 12, color: "var(--warn)" }}>{error}</div>
      ) : null}

      <div style={{ padding: "0 26px 40px" }}>
        <div
          style={{
            border: "1px solid rgb(var(--accent-rgb) / .22)",
            borderRadius: "var(--radius-lg)",
            background: "rgb(var(--surface-rgb) / .55)",
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
                  borderTop: i === 0 ? "none" : "1px solid rgb(var(--accent-rgb) / .12)",
                }}
              >
                <PlayerCell entry={row.home} align="left" leading={homePoints > awayPoints} />

                <div
                  style={{
                    textAlign: "center",
                    fontFamily: "var(--font-heading)",
                    fontSize: 10,
                    letterSpacing: ".14em",
                    color: "var(--accent-link)",
                    background: "rgb(var(--accent-rgb) / .12)",
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

/**
 * The week you are not playing.
 *
 * Said plainly rather than in the warning colour, because a bye is not a
 * fault and an amber line reads as one. And it does not stop at the bad news:
 * the same screen already knows how to put any two franchises side by side,
 * so a manager with nothing of their own to watch can pick a game to watch
 * instead — which is exactly what somebody on a bye is looking for.
 */
function ByeWeek({ bye, onCompare }: { bye: Bye; onCompare: (id: string) => void }) {
  return (
    <div style={{ padding: "24px 26px 40px" }}>
      <div style={{ fontSize: 10, letterSpacing: ".32em", color: "var(--text-dim)" }}>
        WEEK {bye.week}
      </div>
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 34,
          letterSpacing: "-.03em",
          margin: "8px 0 8px",
          fontWeight: 500,
        }}
      >
        You have a bye
      </h1>
      <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "0 0 20px", lineHeight: 1.6, maxWidth: "60ch" }}>
        {bye.message} Nothing you do this week changes your record — but the rest of the league is
        playing, and any two of them can be put side by side here.
      </p>

      {bye.managers.length ? (
        <>
          <div style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--text-dim)", marginBottom: 8 }}>
            WATCH SOMEBODY ELSE
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {bye.managers.map((m) => (
              <button
                key={m.id}
                onClick={() => onCompare(m.id)}
                style={{
                  minHeight: 34,
                  padding: "7px 12px",
                  fontFamily: "inherit",
                  fontSize: 12,
                  color: "var(--text-2)",
                  background: "rgb(var(--surface-rgb) / .55)",
                  border: "1px solid rgb(var(--accent-rgb) / .24)",
                  borderRadius: "var(--radius-sm)",
                  cursor: "pointer",
                }}
              >
                {m.franchise}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
