"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import Skeleton from "./Skeleton";
import { useRefreshable } from "@/lib/use-refresh";
import { player } from "@/lib/roster";
import type { Game } from "@/lib/espn";

/**
 * Every NFL game this week, and which of them you have a stake in.
 *
 * The ticker across the top of the home page carries the same slate, but a
 * ticker is for glancing at — it slides, it shows four games at a time, and on
 * a Sunday afternoon the question is not "what is the score of whatever is
 * passing" but "which of these am I in, and which one do I put on". This is
 * that list, standing still, in kickoff order.
 *
 * The count of your own players in each game is the reason it is not just a
 * scoreboard. Any of a dozen apps will tell you Buffalo are up ten; none of
 * them knows that four of your eighteen are on that field. Read from the pool's
 * own team abbreviations, which are the ones the database matches ESPN on when
 * it decides whether somebody has played.
 */

/** How often the scores refresh. The route caches for 30s, so this matches. */
const REFRESH_MS = 30_000;

const SEASON: Record<number, string> = {
  1: "PRESEASON",
  2: "WEEK",
  3: "POSTSEASON",
};

interface Board {
  games: Game[];
  week: number | null;
  seasonType: number | null;
  played: boolean;
  error?: string;
}

/** The day a game falls on, in the reader's own timezone. */
function dayOf(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

function kickoff(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  return at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

export default function GamesBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [roster, setRoster] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [slate, lineup] = await Promise.all([
      fetch("/api/scoreboard", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      // Whose players are in which game. A failure here costs the counts and
      // nothing else, so it is not allowed to take the scoreboard down.
      fetch("/api/lineup", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);

    if (!slate) return setError("Could not reach the scoreboard.");
    setBoard(slate as Board);
    setError(null);
    if (lineup) setRoster((lineup.roster ?? []) as string[]);
  }, []);

  useRefreshable(load);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // How many of this manager's players each club is fielding. Built once
  // rather than per game — eighteen names against thirty-two clubs, sixteen
  // times over, is work nobody needs done again for every card.
  const mineByTeam = useMemo(() => {
    const counts = new Map<string, number>();
    for (const name of roster) {
      const team = player(name)?.t;
      if (team) counts.set(team, (counts.get(team) ?? 0) + 1);
    }
    return counts;
  }, [roster]);

  const days = useMemo(() => {
    const games = [...(board?.games ?? [])].sort(
      (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
    );
    const out: { day: string; games: Game[] }[] = [];
    for (const game of games) {
      const day = dayOf(game.date);
      const last = out[out.length - 1];
      if (last && last.day === day) last.games.push(game);
      else out.push({ day, games: [game] });
    }
    return out;
  }, [board]);

  if (error && !board) {
    return <div style={{ padding: "24px 26px", color: "var(--warn)" }}>{error}</div>;
  }
  if (!board) return <Skeleton rows={6} />;

  const label =
    board.seasonType === 2 || board.seasonType == null
      ? `${SEASON[2]} ${board.week ?? ""}`.trim()
      : SEASON[board.seasonType] ?? "NFL";

  return (
    <div style={{ padding: "24px 26px 40px", maxWidth: 760, margin: "0 auto" }}>
      <div style={{ fontSize: 10, letterSpacing: ".32em", color: "var(--text-dim)" }}>{label}</div>
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: "clamp(30px, 8vw, 40px)",
          letterSpacing: "-.035em",
          margin: "8px 0 6px",
          fontWeight: 500,
        }}
      >
        NFL Gamecast
      </h1>
      <p style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.65, margin: "0 0 18px" }}>
        Every game this week. Press one for the gamecast — the drive, the box score, and who in
        this league owns a piece of it.
      </p>

      {!board.games.length ? (
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
          No games on the board right now. This fills up as the week&rsquo;s fixtures are
          published.
        </div>
      ) : null}

      {days.map((day) => (
        <section key={day.day} style={{ marginBottom: 18 }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: ".2em",
              color: "var(--text-dim)",
              margin: "0 2px 8px",
            }}
          >
            {day.day.toUpperCase()}
          </div>

          <div
            style={{
              border: "1px solid rgb(var(--accent-rgb) / .2)",
              borderRadius: "var(--radius-lg)",
              overflow: "hidden",
              background: "rgb(var(--surface-rgb) / .55)",
            }}
          >
            {day.games.map((game, i) => (
              <GameRow
                key={game.id}
                game={game}
                first={i === 0}
                mine={
                  (mineByTeam.get(game.home?.abbrev ?? "") ?? 0) +
                  (mineByTeam.get(game.away?.abbrev ?? "") ?? 0)
                }
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function GameRow({ game, first, mine }: { game: Game; first: boolean; mine: number }) {
  const { home, away, state } = game;
  if (!home || !away) return null;

  const started = state !== "pre";
  const live = state === "in";

  return (
    <Link
      href={`/game/${game.id}`}
      aria-label={
        started
          ? `${away.abbrev} ${away.score}, ${home.abbrev} ${home.score}. ${game.statusDetail}. Open gamecast.`
          : `${away.abbrev} at ${home.abbrev}, ${kickoff(game.date)}. Open gamecast.`
      }
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "13px 14px",
        borderTop: first ? undefined : "1px solid rgb(var(--accent-rgb) / .13)",
        textDecoration: "none",
        color: "inherit",
        // A game with your players in it is the one you are looking for.
        background: mine ? "rgb(var(--accent-rgb) / .1)" : undefined,
        boxShadow: mine ? "inset 2px 0 0 var(--accent-link)" : undefined,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <Side side={away} other={home} started={started} />
        <Side side={home} other={away} started={started} />
      </div>

      <div style={{ textAlign: "right", flex: "0 0 auto", display: "grid", gap: 4 }}>
        <div
          style={{
            fontSize: 10,
            letterSpacing: ".12em",
            color: live ? "var(--good)" : "var(--text-dim)",
            display: "flex",
            alignItems: "center",
            gap: 5,
            justifyContent: "flex-end",
          }}
        >
          {live ? (
            <span
              aria-hidden
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                background: "var(--good)",
                flex: "0 0 auto",
              }}
            />
          ) : null}
          {state === "post"
            ? "FINAL"
            : live
              ? (game.statusDetail || "LIVE").toUpperCase()
              : kickoff(game.date).toUpperCase()}
        </div>

        {mine ? (
          <div style={{ fontSize: 10, letterSpacing: ".12em", color: "var(--accent-link)" }}>
            {mine === 1 ? "1 OF YOURS" : `${mine} OF YOURS`}
          </div>
        ) : null}
      </div>
    </Link>
  );
}

/** One club's line: abbreviation, and its score once there is one. The
 * away side is drawn first, which is how a fixture is read aloud. */
function Side({
  side,
  other,
  started,
}: {
  side: { abbrev: string; score: number };
  other: { score: number };
  started: boolean;
}) {
  const winning = started && side.score > other.score;

  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
      <span
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 15,
          letterSpacing: ".02em",
          color: started && !winning ? "var(--text-muted)" : "var(--text)",
          minWidth: 46,
        }}
      >
        {side.abbrev}
      </span>
      {started ? (
        <span
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 16,
            color: winning ? "var(--accent-text)" : "var(--text-quiet)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {side.score}
        </span>
      ) : null}
    </div>
  );
}
