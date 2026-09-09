"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MatchupCard, { type CardGame } from "./MatchupCard";
import Skeleton from "./Skeleton";
import { useRefreshable } from "@/lib/use-refresh";
import { useLogos } from "@/lib/use-logos";

/**
 * Your season, and the league's.
 *
 * The default is your own fixtures start to finish, because "how has my year
 * gone" is the question a manager actually opens this with. The toggle widens
 * it to every game in one week, for the Sunday when what matters is what
 * everybody else is doing.
 */

interface Board {
  meId: string;
  league: { name: string; season: number } | null;
  weeks: number[];
  liveWeek: number | null;
  games: CardGame[];
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

  // Answers a pull-to-refresh as well as its own timer.
  useRefreshable(load);

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

  // Counted on the server now, alongside everybody else's, because every card
  // carries two of them. Read off whichever fixture this manager appears in.
  // Counted on the server now, alongside everybody else's, because every card
  // carries two of them. Read off whichever fixture this manager appears in.
  const record = useMemo(() => {
    const fixture = board?.games.find(
      (g) => g.home.id === board.meId || g.away.id === board.meId,
    );
    const side =
      fixture && (fixture.home.id === board?.meId ? fixture.home : fixture.away);
    const held = side ? side.record : null;
    return held ? { ...held, played: held.w + held.l + held.t } : null;
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
            <MatchupCard
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
