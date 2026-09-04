"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import ScoreBar from "./ScoreBar";
import Skeleton from "./Skeleton";
import TeamCrest from "./TeamCrest";
import { useLogos } from "@/lib/use-logos";

/**
 * Your season, and the league's.
 *
 * The default is your own fixtures start to finish, because "how has my year
 * gone" is the question a manager actually opens this with. The toggle widens
 * it to every game in one week, for the Sunday when what matters is what
 * everybody else is doing.
 */

interface Side {
  id: string;
  slot: string;
  /** Whoever holds the franchise, or "Open" when nobody does yet. */
  name: string;
  claimed: boolean;
  franchise: string;
  division: string | null;
  /** Null for a week that has neither been played nor started. */
  points: number | null;
}

interface Game {
  week: number;
  final: boolean;
  divisional: boolean;
  live: boolean;
  mine: boolean;
  home: Side;
  away: Side;
}

interface Board {
  meId: string;
  league: { name: string; season: number } | null;
  weeks: number[];
  liveWeek: number | null;
  games: Game[];
}

const tab = (active: boolean): React.CSSProperties => ({
  border: `1px solid ${active ? "rgb(var(--accent-bright-rgb) / .6)" : "rgb(var(--accent-rgb) / .24)"}`,
  background: active ? "rgb(var(--accent-rgb) / .24)" : "transparent",
  color: active ? "var(--text)" : "var(--text-quiet)",
  borderRadius: "var(--radius-sm)",
  font: "inherit",
  fontSize: 10.5,
  letterSpacing: ".14em",
  padding: "7px 14px",
  cursor: "pointer",
});

function Score({
  side,
  won,
  lost,
  logo,
}: {
  side: Side;
  won: boolean;
  lost: boolean;
  logo: string | null;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
      <TeamCrest franchise={side.franchise} logo={logo} size={26} shape="box" fallback="empty" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 14,
            color: lost ? "var(--text-quiet)" : "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {side.franchise}
        </div>
        {/* Who is behind the franchise. A team name is a name somebody made
            up; the person is who you are actually playing. */}
        <div
          style={{
            fontSize: 10,
            letterSpacing: ".14em",
            color: side.claimed ? "var(--text-dim)" : "var(--text-faint)",
            marginTop: 2,
          }}
        >
          {side.claimed ? side.name : "Open"}
        </div>
      </div>
      <div
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 19,
          color: won ? "var(--accent-text)" : lost ? "var(--text-quiet)" : "var(--text-3)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {side.points == null ? "—" : side.points.toFixed(1)}
      </div>
    </div>
  );
}

function GameCard({
  game,
  highlight,
  logos,
  meId,
}: {
  game: Game;
  highlight: boolean;
  logos: Record<string, string>;
  /** Whose season this is, so their own fixture can be read from their side. */
  meId: string;
}) {
  const { home, away } = game;
  const settled = game.final;
  const homeWon = settled && (home.points ?? 0) > (away.points ?? 0);
  const awayWon = settled && (away.points ?? 0) > (home.points ?? 0);

  // In your own fixture you go on top. Home and away are a coin toss in a
  // fantasy league — nobody travels — and reading your own week from the
  // second line is a small tax paid twelve times a season. It also lets the
  // bar below mean "you": the fill starts at the left, so the side it is
  // measuring has to be the side written above it.
  const first = game.mine && home.id === meId ? home : away;
  const second = first === home ? away : home;

  const firstWon = first === home ? homeWon : awayWon;
  const secondWon = first === home ? awayWon : homeWon;

  return (
    <div
      role="group"
      aria-label={`Week ${game.week}: ${first.franchise} versus ${second.franchise}`}
      style={{
        border: `1px solid ${highlight ? "rgb(var(--accent-bright-rgb) / .5)" : "rgb(var(--accent-rgb) / .2)"}`,
        borderRadius: "var(--radius-md)",
        background: highlight ? "rgb(var(--accent-rgb) / .1)" : "rgb(var(--surface-rgb) / .55)",
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
          color: "var(--text-dim)",
          marginBottom: 9,
        }}
      >
        WEEK {game.week}
        {game.divisional ? <span style={{ color: "var(--accent-link)" }}>· DIVISION</span> : null}
        <span style={{ marginLeft: "auto", color: game.live ? "var(--good)" : "var(--text-dim)" }}>
          {game.final ? "FINAL" : game.live ? "LIVE" : "TO COME"}
        </span>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <Score side={first} won={firstWon} lost={secondWon} logo={logos[first.id] ?? null} />
        <Score side={second} won={secondWon} lost={firstWon} logo={logos[second.id] ?? null} />
      </div>

      {/* Two numbers are a fact; the distance between them is the game. Only
          once there is one — an unplayed week has no gap to draw, and an
          empty track under a fixture reads as nought-all rather than as not
          yet. Neutral unless it is yours, because "up" and "down" mean
          nothing about somebody else's Sunday. */}
      {(first.points ?? 0) + (second.points ?? 0) > 0 ? (
        <ScoreBar
          mine={first.points ?? 0}
          theirs={second.points ?? 0}
          neutral={!game.mine}
          final={game.final}
          padding="11px 0 0"
        />
      ) : null}
    </div>
  );
}

export default function Matchups() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wholeLeague, setWholeLeague] = useState(false);
  const logos = useLogos();
  const [week, setWeek] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/schedule", { cache: "no-store" });
      if (res.status === 401) return setError("Sign in to see the schedule.");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error ?? "Could not read the schedule.");
      }
      setBoard(await res.json());
      setError(null);
    } catch {
      setError("Could not read the schedule.");
    }
  }, []);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  // The week in play, until somebody chooses another.
  const selected = week ?? board?.liveWeek ?? board?.weeks[0] ?? null;

  const shown = useMemo(() => {
    if (!board) return [];
    return wholeLeague
      ? board.games.filter((g) => g.week === selected)
      : board.games.filter((g) => g.mine);
  }, [board, wholeLeague, selected]);

  const record = useMemo(() => {
    if (!board) return null;
    const mine = board.games.filter((g) => g.mine && g.final);
    let w = 0;
    let l = 0;
    let t = 0;
    for (const g of mine) {
      const me = g.home.id === board.meId ? g.home : g.away;
      const them = g.home.id === board.meId ? g.away : g.home;
      const a = me.points ?? 0;
      const b = them.points ?? 0;
      if (a > b) w++;
      else if (a < b) l++;
      else t++;
    }
    return { w, l, t, played: mine.length };
  }, [board]);

  if (error && !board) {
    return <div style={{ padding: "24px 26px", color: "var(--warn)" }}>{error}</div>;
  }
  if (!board) {
    return <Skeleton rows={4} />;
  }

  return (
    <div style={{ padding: "24px 26px 40px" }}>
      <div style={{ fontSize: 10, letterSpacing: ".32em", color: "var(--text-dim)" }}>THE SEASON</div>
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 40,
          letterSpacing: "-.035em",
          margin: "8px 0 6px",
          fontWeight: 500,
        }}
      >
        Matchups
      </h1>

      {record && record.played ? (
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "0 0 16px" }}>
          You are {record.w}-{record.l}
          {record.t ? `-${record.t}` : ""} through {record.played}{" "}
          {record.played === 1 ? "week" : "weeks"}.
        </p>
      ) : (
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", margin: "0 0 16px" }}>
          Nothing has been settled yet.
        </p>
      )}

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 14 }}>
        <button
          onClick={() => setWholeLeague(false)}
          aria-current={!wholeLeague ? "page" : undefined}
          style={tab(!wholeLeague)}
        >
          MY SEASON
        </button>
        <button
          onClick={() => setWholeLeague(true)}
          aria-current={wholeLeague ? "page" : undefined}
          style={tab(wholeLeague)}
        >
          WHOLE LEAGUE
        </button>

        {/* Only meaningful for the league view: your own season is every week
            already, and a week picker beside it would do nothing. */}
        {wholeLeague ? (
          <select
            value={selected ?? ""}
            aria-label="Week"
            onChange={(e) => setWeek(Number(e.target.value))}
            style={{
              marginLeft: 6,
              padding: "7px 10px",
              background: "rgb(var(--sunken-rgb) / .8)",
              border: "1px solid rgb(var(--accent-rgb) / .3)",
              borderRadius: "var(--radius-sm)",
              color: "var(--text)",
              font: "inherit",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {board.weeks.map((w) => (
              <option key={w} value={w}>
                Week {w}
                {w === board.liveWeek ? " · now" : ""}
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {!shown.length ? (
        <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
          {board.weeks.length
            ? "Nothing scheduled here."
            : "No schedule yet. The commissioner builds it once every franchise is claimed."}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(min(300px,100%),1fr))",
            gap: 9,
          }}
        >
          {shown.map((g) => (
            <GameCard
              key={`${g.week}-${g.home.id}-${g.away.id}`}
              game={g}
              highlight={wholeLeague ? g.mine : g.live}
              logos={logos}
              meId={board.meId}
            />
          ))}
        </div>
      )}
    </div>
  );
}
