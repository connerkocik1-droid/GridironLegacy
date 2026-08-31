"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
  border: `1px solid ${active ? "rgba(181,171,252,.6)" : "rgba(145,132,217,.24)"}`,
  background: active ? "rgba(145,132,217,.24)" : "transparent",
  color: active ? "#e9e9ed" : "#8f94a8",
  borderRadius: "var(--radius-sm)",
  font: "inherit",
  fontSize: 10.5,
  letterSpacing: ".14em",
  padding: "7px 14px",
  cursor: "pointer",
});

function Score({ side, won, lost }: { side: Side; won: boolean; lost: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, minWidth: 0 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 14,
            color: lost ? "#8f94a8" : "#e9e9ed",
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
            fontSize: 9.5,
            letterSpacing: ".14em",
            color: side.claimed ? "#75798c" : "#5a5d6e",
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
          color: won ? "#d2cefd" : lost ? "#8f94a8" : "#b2b6ca",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {side.points == null ? "—" : side.points.toFixed(1)}
      </div>
    </div>
  );
}

function GameCard({ game, highlight }: { game: Game; highlight: boolean }) {
  const { home, away } = game;
  const settled = game.final;
  const homeWon = settled && (home.points ?? 0) > (away.points ?? 0);
  const awayWon = settled && (away.points ?? 0) > (home.points ?? 0);

  return (
    <div
      role="group"
      aria-label={`Week ${game.week}: ${away.franchise} at ${home.franchise}`}
      style={{
        border: `1px solid ${highlight ? "rgba(181,171,252,.5)" : "rgba(145,132,217,.2)"}`,
        borderRadius: "var(--radius-md)",
        background: highlight ? "rgba(145,132,217,.1)" : "rgba(26,28,43,.55)",
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
          color: "#75798c",
          marginBottom: 9,
        }}
      >
        WEEK {game.week}
        {game.divisional ? <span style={{ color: "#b5abfc" }}>· DIVISION</span> : null}
        <span style={{ marginLeft: "auto", color: game.live ? "#7fd1a8" : "#75798c" }}>
          {game.final ? "FINAL" : game.live ? "LIVE" : "TO COME"}
        </span>
      </div>

      <div style={{ display: "grid", gap: 8 }}>
        <Score side={away} won={awayWon} lost={homeWon} />
        <Score side={home} won={homeWon} lost={awayWon} />
      </div>
    </div>
  );
}

export default function Matchups() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [wholeLeague, setWholeLeague] = useState(false);
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
    return <div style={{ padding: "24px 26px", color: "#e0b573" }}>{error}</div>;
  }
  if (!board) {
    return <div style={{ padding: "24px 26px", color: "#75798c" }}>Reading the schedule…</div>;
  }

  return (
    <div style={{ padding: "24px 26px 40px" }}>
      <div style={{ fontSize: 9, letterSpacing: ".32em", color: "#75798c" }}>THE SEASON</div>
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
        <p style={{ fontSize: 12.5, color: "#9397ab", margin: "0 0 16px" }}>
          You are {record.w}-{record.l}
          {record.t ? `-${record.t}` : ""} through {record.played}{" "}
          {record.played === 1 ? "week" : "weeks"}.
        </p>
      ) : (
        <p style={{ fontSize: 12.5, color: "#9397ab", margin: "0 0 16px" }}>
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
              background: "rgba(20,22,35,.8)",
              border: "1px solid rgba(145,132,217,.3)",
              borderRadius: "var(--radius-sm)",
              color: "#e9e9ed",
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
        <div style={{ fontSize: 12.5, color: "#9397ab", lineHeight: 1.6 }}>
          {board.weeks.length
            ? "Nothing scheduled here."
            : "No schedule yet. The commissioner builds it once every franchise is claimed."}
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))",
            gap: 9,
          }}
        >
          {shown.map((g) => (
            <GameCard
              key={`${g.week}-${g.home.id}-${g.away.id}`}
              game={g}
              highlight={wholeLeague ? g.mine : g.live}
            />
          ))}
        </div>
      )}
    </div>
  );
}
