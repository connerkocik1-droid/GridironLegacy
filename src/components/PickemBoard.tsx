"use client";

import { useCallback, useEffect, useState } from "react";
import { logo } from "@/data/league-data";

interface Game {
  id: string;
  week: number;
  starts_at: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  state: "pre" | "in" | "post";
  winner: string | null;
  completed: boolean;
}

/**
 * A game as ESPN has it right now.
 *
 * The stored row is the record — it is what picks are graded against and what
 * locks them at kickoff — but it is only refreshed when the scoring job runs.
 * This is the same board the home ticker reads, cached once for everyone, and
 * it is what turns a kickoff time into a quarter and a score while the game is
 * actually being played.
 */
interface LiveGame {
  id: string;
  state: "pre" | "in" | "post";
  statusDetail: string;
  home: { abbrev: string; score: number } | null;
  away: { abbrev: string; score: number } | null;
}

interface Standing {
  managerId: string;
  slot: string;
  franchise: string;
  correct: number;
  played: number;
  pct: number;
}

interface Board {
  week: number | null;
  me?: { id: string; slot: string; franchise: string };
  games: Game[];
  picks: Record<string, string>;
  standings: Standing[];
}

const card: React.CSSProperties = {
  border: "1px solid rgb(var(--accent-rgb) / .22)",
  borderRadius: "var(--radius-lg)",
  background: "rgb(var(--surface-rgb) / .55)",
};

const kicker: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: ".28em",
  color: "var(--text-dim)",
};

function kickoff(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * ESPN writes the clock a dozen ways — "3rd Quarter", "8:42 - 3rd", "Halftime",
 * "End of 2nd", "OT". Whatever it says is what the game is doing, so it is
 * shown as given rather than parsed into a shape of this app's invention. Only
 * the case is changed, to sit with the rest of the row.
 */
function clockOf(detail: string): string {
  const said = detail.trim();
  return said ? said.toUpperCase() : "LIVE";
}

export default function PickemBoard() {
  const [board, setBoard] = useState<Board | null>(null);
  const [live, setLive] = useState<Record<string, LiveGame>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/pickem", { cache: "no-store" });
      if (res.status === 401) {
        setError("Sign in to make your picks.");
        return;
      }
      if (res.status === 503) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "The league database is not configured yet.");
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      const body: Board = await res.json();
      setBoard(body);
      setError(null);

      // Matched by ESPN's own event id, which is what nfl_games is keyed on,
      // so there is no guessing from team names or kickoff times.
      if (body.week != null) {
        try {
          const board = await fetch(`/api/scoreboard?week=${body.week}`, { cache: "no-store" });
          if (board.ok) {
            const games: LiveGame[] = (await board.json()).games ?? [];
            setLive(Object.fromEntries(games.map((g) => [g.id, g])));
          }
        } catch {
          // The stored rows still render. Live state is a bonus on top of
          // them, never the thing the page depends on.
        }
      }
    } catch {
      setError("Could not load this week's games.");
    }
  }, []);

  useEffect(() => {
    // The board is fetched on mount rather than server-rendered. `load` only
    // sets state once its request resolves, so this is not the synchronous
    // cascade the rule guards against.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // A clock that updates once a minute is a clock that is wrong. Thirty
    // seconds matches the cache in front of ESPN, so this never asks for
    // anything fresher than exists.
    const timer = setInterval(() => void load(), 30_000);
    return () => clearInterval(timer);
  }, [load]);

  async function choose(game: Game, team: string) {
    if (game.state !== "pre") return;

    setSaving(game.id);
    // Show the pick immediately, then reconcile with what the server accepted.
    setBoard((prev) =>
      prev ? { ...prev, picks: { ...prev.picks, [game.id]: team } } : prev,
    );

    try {
      const res = await fetch("/api/pickem", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ gameId: game.id, pick: team }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Pick was not saved.");
        await load();
      } else {
        setError(null);
      }
    } catch {
      setError("Pick was not saved.");
      await load();
    } finally {
      setSaving(null);
    }
  }

  if (error && !board) {
    return <div style={{ padding: "24px 26px", color: "var(--warn)" }}>{error}</div>;
  }

  if (!board) {
    return <div style={{ padding: "24px 26px", color: "var(--text-dim)" }}>Reading the schedule…</div>;
  }

  const made = board.games.filter((g) => board.picks[g.id]).length;

  return (
    <>
      <div style={{ padding: "24px 26px 12px", display: "flex", alignItems: "flex-end", gap: 26, flexWrap: "wrap" }}>
        <div>
          <div style={kicker}>WEEKLY PICK-&apos;EM</div>
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 44,
              lineHeight: 1.04,
              letterSpacing: "-.035em",
              margin: "8px 0 0",
            }}
          >
            {board.week != null ? `Week ${board.week}` : "No games scheduled"}
          </div>
        </div>
        <div style={{ marginLeft: "auto", textAlign: "right" }}>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 26, color: "var(--accent-text)" }}>
            {made} / {board.games.length}
          </div>
          <div style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--text-dim)" }}>PICKS MADE</div>
        </div>
      </div>

      <div style={{ padding: "0 26px 8px", fontSize: 12, color: "var(--text-muted)", maxWidth: "70ch", lineHeight: 1.6 }}>
        Take a winner in every game. Picks lock at each kickoff — a game already
        under way cannot be changed. Ties score nothing for anyone.
      </div>

      {error ? (
        <div style={{ padding: "0 26px 8px", fontSize: 12, color: "var(--warn)" }}>{error}</div>
      ) : null}

      <div className="gl-cols"
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) minmax(280px,340px)",
          gap: 18,
          padding: "12px 26px 40px",
          alignItems: "start",
        }}
      >
        <div style={{ ...card, overflow: "hidden" }}>
          {board.games.length === 0 ? (
            <div style={{ padding: "18px", fontSize: 12, color: "var(--text-dim)" }}>
              No games mirrored yet. The scoring job fills this in.
            </div>
          ) : null}

          {board.games.map((game) => {
            const picked = board.picks[game.id];

            // What ESPN says now beats what was stored at the last scoring
            // run, for everything except grading — a pick is settled against
            // the record, not against a page that happened to be open.
            const now = live[game.id];
            const state = now?.state ?? game.state;
            const homeScore = now?.home?.score ?? game.home_score;
            const awayScore = now?.away?.score ?? game.away_score;
            const scoreOf = (team: string) =>
              team === game.home_team ? homeScore : awayScore;

            const locked = state !== "pre";
            const graded = game.completed && game.winner;

            return (
              <div
                key={game.id}
                className="gl-pickem-row"
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 18px",
                  borderTop: "1px solid rgb(var(--accent-rgb) / .12)",
                  opacity: saving === game.id ? 0.6 : 1,
                }}
              >
                {/* Before kickoff this says when. Once the ball is in the air
                    it says what quarter it is and what the score is, and when
                    it is over it says so with the final score. */}
                <div
                  style={{
                    width: 112,
                    flex: "0 0 auto",
                    fontSize: 10,
                    letterSpacing: ".12em",
                    color: "var(--text-dim)",
                  }}
                >
                  {state === "in" ? (
                    <>
                      <div
                        style={{ color: "var(--good)", animation: "mt-pulse 1.6s ease infinite" }}
                      >
                        {clockOf(now?.statusDetail ?? "")}
                      </div>
                      <div
                        style={{
                          fontFamily: "var(--font-heading)",
                          fontSize: 13,
                          color: "var(--accent-text)",
                          marginTop: 3,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {awayScore}–{homeScore}
                      </div>
                    </>
                  ) : state === "post" ? (
                    <>
                      <div>FINAL</div>
                      <div
                        style={{
                          fontFamily: "var(--font-heading)",
                          fontSize: 13,
                          color: "var(--text-3)",
                          marginTop: 3,
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {awayScore}–{homeScore}
                      </div>
                    </>
                  ) : (
                    kickoff(game.starts_at)
                  )}
                </div>

                <div style={{ display: "flex", gap: 8, flex: 1, minWidth: 0 }}>
                  {[game.away_team, game.home_team].map((team) => {
                    const isPick = picked === team;
                    const won = graded && game.winner === team;
                    const lost = graded && game.winner !== team;

                    return (
                      <button
                        key={team}
                        onClick={() => choose(game, team)}
                        disabled={locked}
                        style={{
                          flex: 1,
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "9px 11px",
                          borderRadius: "var(--radius-md)",
                          font: "inherit",
                          cursor: locked ? "default" : "pointer",
                          color: "inherit",
                          textAlign: "left",
                          border: `1px solid ${
                            isPick ? "rgb(var(--accent-bright-rgb) / .75)" : "rgb(var(--accent-rgb) / .24)"
                          }`,
                          background: isPick
                            ? "linear-gradient(90deg,rgb(var(--accent-rgb) / .32),rgb(var(--sunken-rgb) / .6))"
                            : "rgb(var(--sunken-rgb) / .6)",
                          opacity: locked && !isPick ? 0.55 : 1,
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={logo(team)}
                          alt=""
                          width={20}
                          height={20}
                          style={{ objectFit: "contain", flex: "0 0 auto" }}
                        />
                        <span style={{ fontFamily: "var(--font-heading)", fontSize: 13 }}>{team}</span>
                        {locked ? (
                          <span style={{ marginLeft: "auto", fontSize: 13, color: "var(--text-3)" }}>
                            {scoreOf(team)}
                          </span>
                        ) : null}
                        {isPick && graded ? (
                          <span
                            style={{
                              marginLeft: locked ? 8 : "auto",
                              fontSize: 10,
                              letterSpacing: ".14em",
                              color: won ? "var(--good)" : "var(--warn)",
                            }}
                          >
                            {won ? "HIT" : lost ? "MISS" : ""}
                          </span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        <div style={{ ...card, padding: "16px 18px" }}>
          <h6 style={{ margin: "0 0 10px", color: "var(--accent-text)" }}>Season standings</h6>
          {board.standings.length === 0 ? (
            <div style={{ fontSize: 11, color: "var(--text-dim)" }}>Nothing graded yet.</div>
          ) : null}
          {board.standings.map((s, i) => (
            <div
              key={s.managerId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "7px 0",
                borderTop: "1px solid rgb(var(--accent-rgb) / .12)",
              }}
            >
              <span style={{ width: 18, fontSize: 11, color: "var(--text-dim)", flex: "0 0 auto" }}>{i + 1}</span>
              <span
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 13,
                  minWidth: 0,
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: s.managerId === board.me?.id ? "var(--accent-text)" : undefined,
                }}
              >
                {s.franchise}
              </span>
              <span style={{ fontSize: 11, color: "var(--text-muted)", flex: "0 0 auto" }}>
                {s.correct}/{s.played}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
