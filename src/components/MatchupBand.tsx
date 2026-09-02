"use client";

import Link from "next/link";
import TeamCrest from "./TeamCrest";
import { useLogos } from "@/lib/use-logos";
import type { Home, HomeSide } from "@/lib/home-types";

const card: React.CSSProperties = {
  border: "1px solid rgba(181,171,252,.4)",
  borderRadius: "var(--radius-lg)",
  background: "rgba(145,132,217,.1)",
  overflow: "hidden",
};

/**
 * Managers sign up with a first name, but a name typed into a box is whatever
 * somebody typed. The first word of it is the part that belongs on a
 * scoreboard either way.
 */
function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}

function Side({
  side,
  logo,
  score,
  winning,
  mine,
}: {
  side: HomeSide;
  logo: string | null;
  /** Absent before the week starts: there is no score to show, not a zero. */
  score: number | null;
  winning: boolean;
  mine: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderTop: "1px solid rgba(145,132,217,.14)",
      }}
    >
      <TeamCrest franchise={side.franchise} logo={logo} size={38} shape="box" fallback="initials" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 16,
            letterSpacing: "-.01em",
            color: mine ? "#d2cefd" : "#e9e9ed",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {side.franchise}
        </div>
        <div style={{ fontSize: 11.5, color: "#75798c", marginTop: 2 }}>
          {firstName(side.name)}
          {mine ? <span style={{ color: "#b5abfc" }}> · you</span> : null}
        </div>
      </div>
      {score != null ? (
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 26,
            fontVariantNumeric: "tabular-nums",
            color: winning ? "#e9e9ed" : "#9397ab",
            flex: "0 0 auto",
          }}
        >
          {score.toFixed(1)}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Your game, and nothing else about it.
 *
 * The first thing under the ticker, because on a Sunday it is the only
 * question anybody has. Two franchises, who owns them, and the score — no
 * lineups, no projections. Lineup is where both teams are set out player by
 * player, and this links there.
 *
 * Three states, and the difference between the first two is the whole point:
 * before kickoff there is no score to show, so it shows none rather than two
 * zeroes that look like a game nobody turned up for.
 */
export default function MatchupBand({ home }: { home: Home | null }) {
  const logos = useLogos();

  if (!home) {
    return <div style={{ fontSize: 12, color: "#75798c" }}>Reading the league…</div>;
  }

  const game = home.games.find((g) => g.mine);

  if (!game) {
    const onBye = home.week != null && home.games.length > 0;
    return (
      <div style={{ ...card, padding: "14px 16px", fontSize: 12.5, color: "#9397ab" }}>
        {onBye
          ? "No fixture this week — you have a bye."
          : "No fixtures yet. The commissioner builds the schedule once every franchise is claimed."}
      </div>
    );
  }

  // `started` is about the slate, not this fixture: a franchise whose players
  // are all on Monday night is still in a week that has begun, and showing it
  // a dash rather than a zero would be the wrong kind of honest.
  const started = home.started || game.final;

  // Two ways to be finished. `game.final` is the league's — the week has been
  // graded and the result is in a record. A slate where every game is over is
  // the NFL's, and it comes first: between the last whistle and the small
  // hours when grading runs, the score on this card cannot change, and calling
  // it current would be telling a manager to keep watching.
  const done = game.final || home.weekPhase === "final";
  const label = done ? "FINAL" : started ? "CURRENT MATCHUP" : "NEXT MATCHUP";

  const homeScore = started ? game.home.total : null;
  const awayScore = started ? game.away.total : null;

  return (
    <>
      <div style={card}>
        <div
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 10,
            padding: "10px 16px",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              fontSize: 10,
              letterSpacing: ".22em",
              color: done ? "#75798c" : started ? "#7fd1a8" : "#b5abfc",
            }}
          >
            {label}
          </span>
          {home.week != null ? (
            <span style={{ fontSize: 11, color: "#75798c" }}>Week {home.week}</span>
          ) : null}
        </div>

        <Side
          side={game.home}
          logo={logos[game.home.id] ?? null}
          score={homeScore}
          winning={homeScore != null && awayScore != null && homeScore >= awayScore}
          mine={game.home.id === home.meId}
        />
        <Side
          side={game.away}
          logo={logos[game.away.id] ?? null}
          score={awayScore}
          winning={homeScore != null && awayScore != null && awayScore >= homeScore}
          mine={game.away.id === home.meId}
        />
      </div>

      <div style={{ marginTop: 10, fontSize: 11 }}>
        <Link
          href="/lineup"
          style={{
            color: "#b5abfc",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            minHeight: 34,
          }}
        >
          Both lineups, player by player →
        </Link>
      </div>
    </>
  );
}
