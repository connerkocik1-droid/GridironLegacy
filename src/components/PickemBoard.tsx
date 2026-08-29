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
  border: "1px solid rgba(145,132,217,.22)",
  borderRadius: "var(--radius-lg)",
  background: "rgba(26,28,43,.55)",
};

const kicker: React.CSSProperties = {
  fontSize: 9,
  letterSpacing: ".28em",
  color: "#75798c",
};

function kickoff(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function PickemBoard() {
  const [board, setBoard] = useState<Board | null>(null);
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
      setBoard(await res.json());
      setError(null);
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
    // Live scores move during games; the board refreshes rather than going stale.
    const timer = setInterval(() => void load(), 60_000);
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
    return <div style={{ padding: "24px 26px", color: "#e0b573" }}>{error}</div>;
  }

  if (!board) {
    return <div style={{ padding: "24px 26px", color: "#75798c" }}>Reading the schedule…</div>;
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
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 26, color: "#d2cefd" }}>
            {made} / {board.games.length}
          </div>
          <div style={{ fontSize: 9, letterSpacing: ".2em", color: "#75798c" }}>PICKS MADE</div>
        </div>
      </div>

      <div style={{ padding: "0 26px 8px", fontSize: 12, color: "#9397ab", maxWidth: "70ch", lineHeight: 1.6 }}>
        Take a winner in every game. Picks lock at each kickoff — a game already
        under way cannot be changed. Ties score nothing for anyone.
      </div>

      {error ? (
        <div style={{ padding: "0 26px 8px", fontSize: 12, color: "#e0b573" }}>{error}</div>
      ) : null}

      <div
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
            <div style={{ padding: "18px", fontSize: 12, color: "#75798c" }}>
              No games mirrored yet. The scoring job fills this in.
            </div>
          ) : null}

          {board.games.map((game) => {
            const picked = board.picks[game.id];
            const locked = game.state !== "pre";
            const graded = game.completed && game.winner;

            return (
              <div
                key={game.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 18px",
                  borderTop: "1px solid rgba(145,132,217,.12)",
                  opacity: saving === game.id ? 0.6 : 1,
                }}
              >
                <div style={{ width: 92, flex: "0 0 auto", fontSize: 10, letterSpacing: ".12em", color: "#75798c" }}>
                  {game.state === "in" ? (
                    <span style={{ color: "#b5abfc", animation: "mt-pulse 1.6s ease infinite" }}>LIVE</span>
                  ) : game.completed ? (
                    "FINAL"
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
                            isPick ? "rgba(181,171,252,.75)" : "rgba(145,132,217,.24)"
                          }`,
                          background: isPick
                            ? "linear-gradient(90deg,rgba(145,132,217,.32),rgba(20,22,35,.6))"
                            : "rgba(20,22,35,.6)",
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
                          <span style={{ marginLeft: "auto", fontSize: 13, color: "#b2b6ca" }}>
                            {team === game.home_team ? game.home_score : game.away_score}
                          </span>
                        ) : null}
                        {isPick && graded ? (
                          <span
                            style={{
                              marginLeft: locked ? 8 : "auto",
                              fontSize: 9,
                              letterSpacing: ".14em",
                              color: won ? "#7fd1a8" : "#e0b573",
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
          <h6 style={{ margin: "0 0 10px", color: "#d2cefd" }}>Season standings</h6>
          {board.standings.length === 0 ? (
            <div style={{ fontSize: 11, color: "#75798c" }}>Nothing graded yet.</div>
          ) : null}
          {board.standings.map((s, i) => (
            <div
              key={s.managerId}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "7px 0",
                borderTop: "1px solid rgba(145,132,217,.12)",
              }}
            >
              <span style={{ width: 18, fontSize: 11, color: "#75798c", flex: "0 0 auto" }}>{i + 1}</span>
              <span
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 13,
                  minWidth: 0,
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  color: s.managerId === board.me?.id ? "#d2cefd" : undefined,
                }}
              >
                {s.franchise}
              </span>
              <span style={{ fontSize: 11, color: "#9397ab", flex: "0 0 auto" }}>
                {s.correct}/{s.played}
              </span>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
