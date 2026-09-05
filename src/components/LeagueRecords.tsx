"use client";

import { useCallback, useEffect, useState } from "react";
import { records, type RecordGame, type Records } from "@/lib/records";
import { useRefreshable } from "@/lib/use-refresh";

/**
 * The season, as the league would tell it.
 *
 * The table says who is winning. It never says that somebody put a hundred
 * and seventy on the board in week three, that the closest game of the year
 * went by two tenths, or that the manager in fourth has won five straight and
 * is coming for you. That is the half of a fantasy season people actually
 * talk about, and it was sitting unread in a schedule the app already had.
 *
 * Under the table rather than above it, because it is the story and the table
 * is the fact. And silent until a week has been settled: a records card in
 * August that says "—" four times is a card that teaches people to ignore it.
 */
export default function LeagueRecords() {
  const [board, setBoard] = useState<Records | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/schedule", { cache: "no-store" });
      if (!res.ok) return;
      const body = (await res.json()) as { games?: RecordGame[] };
      setBoard(records(body.games ?? []));
    } catch {
      // The table above this is the page. A missing story is not worth a
      // warning of its own.
    }
  }, []);

  useRefreshable(load);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!board || board.played === 0) return null;

  const lines: [string, React.ReactNode][] = [];

  if (board.highest) {
    lines.push([
      "HIGHEST",
      <>
        <Big>{board.highest.points.toFixed(1)}</Big> by {board.highest.franchise}, week{" "}
        {board.highest.week}
      </>,
    ]);
  }

  if (board.biggest) {
    lines.push([
      "BIGGEST WIN",
      <>
        {board.biggest.winner} by <Big>{board.biggest.margin.toFixed(1)}</Big> over{" "}
        {board.biggest.loser}, week {board.biggest.week}
      </>,
    ]);
  }

  if (board.closest) {
    lines.push([
      "CLOSEST",
      <>
        {board.closest.winner} by <Big>{board.closest.margin.toFixed(1)}</Big> over{" "}
        {board.closest.loser}, week {board.closest.week}
      </>,
    ]);
  }

  // The one that gets talked about in the chat: a huge week that lost anyway.
  // Only worth printing when it beat somebody else's winning score, which is
  // what makes it unlucky rather than merely a defeat.
  if (board.unluckiest && board.highest && board.unluckiest.points < board.highest.points) {
    lines.push([
      "MOST IN A LOSS",
      <>
        <Big>{board.unluckiest.points.toFixed(1)}</Big> by {board.unluckiest.franchise}, week{" "}
        {board.unluckiest.week}
      </>,
    ]);
  }

  if (board.streak) {
    const run = Math.abs(board.streak.run);
    lines.push([
      board.streak.run > 0 ? "ON A RUN" : "IN A SLUMP",
      <>
        {board.streak.franchise} — <Big>{run}</Big> {board.streak.run > 0 ? "straight" : "in a row"}
      </>,
    ]);
  }

  if (!lines.length) return null;

  return (
    <div style={{ marginTop: 26 }}>
      <div
        style={{
          fontSize: 10,
          letterSpacing: ".28em",
          color: "var(--text-dim)",
          marginBottom: 12,
        }}
      >
        THE SEASON SO FAR
      </div>

      <div
        style={{
          border: "1px solid rgb(var(--accent-rgb) / .22)",
          borderRadius: "var(--radius-lg)",
          background: "rgb(var(--surface-rgb) / .55)",
          overflow: "hidden",
        }}
      >
        {lines.map(([label, said], i) => (
          <div
            key={label}
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: 12,
              padding: "11px 16px",
              borderTop: i === 0 ? undefined : "1px solid rgb(var(--accent-rgb) / .12)",
              flexWrap: "wrap",
              rowGap: 3,
            }}
          >
            <div
              style={{
                fontSize: 10,
                letterSpacing: ".16em",
                color: "var(--accent-link)",
                flex: "0 0 auto",
                // Wide enough for MOST IN A LOSS so the sentences line up,
                // and allowed to give it back when there is no room.
                minWidth: 96,
              }}
            >
              {label}
            </div>
            <div style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5, minWidth: 0 }}>
              {said}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** The number, which is the part anybody repeats out loud. */
function Big({ children }: { children: React.ReactNode }) {
  return (
    <strong style={{ fontFamily: "var(--font-heading)", fontWeight: 500, color: "var(--text)" }}>
      {children}
    </strong>
  );
}
