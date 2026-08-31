"use client";

import { useCallback, useEffect, useState } from "react";
import type { Game } from "@/lib/espn";

/**
 * Every NFL game on right now, sliding across the top of the home page.
 *
 * It asks the scoreboard for whatever is current rather than for a week, so
 * through August it carries the preseason and switches itself over when the
 * season starts — nobody has to remember to change it.
 *
 * The strip is one long line of games rather than a grid because it is meant
 * to be glanced at, not read. Hovering or tabbing into it stops the motion,
 * and a reader who has asked for reduced motion gets the same list as
 * something they scroll themselves.
 */

const SEASON: Record<number, string> = {
  1: "PRESEASON",
  2: "NFL",
  3: "POSTSEASON",
};

/** How often the scores refresh. The route caches for 30s, so this matches. */
const REFRESH_MS = 30_000;

/** Seconds each game takes to cross, which sets the pace of the whole strip. */
const SECONDS_EACH = 4.2;

interface Board {
  games: Game[];
  week: number | null;
  seasonType: number | null;
  /** Whether anything on this slate has been played. */
  played: boolean;
  error?: string;
  fetchedAt: string | null;
}

/** Kickoff, in the reader's own timezone, for a game that has not started. */
function kickoff(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function GameCell({ game }: { game: Game }) {
  const { home, away, state } = game;
  if (!home || !away) return null;

  const started = state !== "pre";
  const homeWon = started && home.score > away.score;
  const awayWon = started && away.score > home.score;

  const label = started
    ? `${away.abbrev} ${away.score}, ${home.abbrev} ${home.score}. ${game.statusDetail}`
    : `${away.abbrev} at ${home.abbrev}, ${kickoff(game.date)}`;

  const team = (abbrev: string, score: number, winning: boolean) => (
    <>
      <span style={{ color: winning ? "#e9e9ed" : "#9397ab", letterSpacing: ".06em" }}>
        {abbrev}
      </span>
      {started ? (
        <span
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 12.5,
            color: winning ? "#d2cefd" : "#8f94a8",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {score}
        </span>
      ) : null}
    </>
  );

  return (
    <span
      role="listitem"
      aria-label={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "0 15px",
        borderRight: "1px solid rgba(145,132,217,.12)",
        whiteSpace: "nowrap",
        fontSize: 10.5,
      }}
    >
      {team(away.abbrev, away.score, awayWon)}
      <span aria-hidden style={{ color: "#5a5d6e" }}>@</span>
      {team(home.abbrev, home.score, homeWon)}

      <span
        style={{
          fontSize: 8,
          letterSpacing: ".12em",
          color: state === "in" ? "#7fd1a8" : "#75798c",
          marginLeft: 2,
        }}
      >
        {state === "post"
          ? "FINAL"
          : state === "in"
            ? (game.statusDetail || "LIVE").toUpperCase()
            : kickoff(game.date).toUpperCase()}
      </span>
    </span>
  );
}

export default function ScoreTicker() {
  const [board, setBoard] = useState<Board | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/scoreboard?prefer=results", { cache: "no-store" });
      if (!res.ok) return;
      setBoard(await res.json());
    } catch {
      // The strip is a bonus, not the page. A failed refresh keeps whatever
      // it was already showing rather than blanking mid-Sunday.
    }
  }, []);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Nothing to say yet, or ESPN is down: no strip at all rather than an empty
  // rail pretending to be one.
  const games = (board?.games ?? []).filter((g) => g.home && g.away);
  if (!games.length) return null;

  const live = games.filter((g) => g.state === "in").length;
  const season = SEASON[board?.seasonType ?? 2] ?? "NFL";
  const week = board?.week ? ` · WK ${board.week}` : "";

  return (
    <div
      className="gl-ticker"
      style={{
        display: "flex",
        alignItems: "stretch",
        borderBottom: "1px solid rgba(145,132,217,.18)",
        background: "rgba(20,22,35,.5)",
        height: 34,
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
            background: live ? "#7fd1a8" : "#5a5d6e",
            animation: live ? "mt-pulse 1.6s ease infinite" : undefined,
          }}
        />
        <span
          style={{ fontSize: 8.5, letterSpacing: ".18em", color: "#9397ab", whiteSpace: "nowrap" }}
        >
          {season}
          {week}
        </span>
        <span
          style={{ fontSize: 8.5, letterSpacing: ".12em", color: "#75798c", whiteSpace: "nowrap" }}
        >
          {live
            ? `${live} LIVE`
            : board?.played
              ? `${games.length} FINAL`
              : `${games.length} ${games.length === 1 ? "GAME" : "GAMES"}`}
        </span>
      </div>

      {/* The rail clips the track; the track is what moves. */}
      <div className="gl-ticker-rail" style={{ flex: 1, minWidth: 0 }}>
        <div
          className="gl-ticker-track"
          role="list"
          aria-label={`${season === "NFL" ? "" : `${season.toLowerCase()} `}scores`.trim()}
          style={{
            display: "flex",
            alignItems: "center",
            height: "100%",
            width: "max-content",
            animationDuration: `${games.length * SECONDS_EACH}s`,
          }}
        >
          {/* Twice, so the second copy is already in place as the first leaves.
              The copy is hidden from screen readers, which should hear the
              list once. */}
          {[0, 1].map((copy) => (
            <div key={copy} aria-hidden={copy === 1} style={{ display: "flex", height: "100%", alignItems: "center" }}>
              {games.map((g) => (
                <GameCell key={`${copy}-${g.id}`} game={g} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
