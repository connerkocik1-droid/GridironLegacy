"use client";

import { useState } from "react";
import Skeleton from "./Skeleton";
import Link from "next/link";
import TeamCrest from "./TeamCrest";
import LiveNumber from "./LiveNumber";
import ScoreBar from "./ScoreBar";
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
        <LiveNumber
          value={score}
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 26,
            color: winning ? "#e9e9ed" : "#9397ab",
            flex: "0 0 auto",
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * Your game first, and then the rest of the week.
 *
 * The first thing under the ticker, because on a Sunday it is the only
 * question anybody has. Two franchises, who owns them, and the score — no
 * lineups, no projections.
 *
 * The arrows step through every fixture in the week without leaving the page.
 * This used to be a link to a page listing them all, which is two taps and a
 * load to answer "what is everyone else on" — a question a manager asks about
 * once a minute on a Sunday afternoon. The whole week is already in this
 * response, so the cheapest possible answer was a page navigation away for no
 * reason.
 *
 * Three states, and the difference between the first two is the whole point:
 * before kickoff there is no score to show, so it shows none rather than two
 * zeroes that look like a game nobody turned up for.
 */
export default function MatchupBand({ home }: { home: Home | null }) {
  const logos = useLogos();

  // Counted from your own game rather than stored as a position in the list.
  // The fixtures arrive after the first render, so an index would have to be
  // corrected in an effect once they did; an offset is right from the start
  // and stays right if the list changes underneath it.
  const [step, setStep] = useState(0);

  if (!home) {
    return <Skeleton rows={2} title={false} style={{ padding: 0 }} />;
  }

  const count = home.games.length;
  const mineAt = home.games.findIndex((g) => g.mine);
  const at = count ? (((mineAt < 0 ? 0 : mineAt) + step) % count + count) % count : 0;
  const game = count ? home.games[at] : undefined;

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
  const label = !game.mine
    ? "IN THE LEAGUE"
    : done
      ? "FINAL"
      : started
        ? "CURRENT MATCHUP"
        : "NEXT MATCHUP";

  const homeScore = started ? game.home.total : null;
  const awayScore = started ? game.away.total : null;

  return (
    <>
      <div style={card}>
        {/* One row, never two. The arrows were wrapping onto a line of their
            own at phone widths, which put forty pixels of nothing at the top
            of the card the whole page is built around. The label is the part
            that gives. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 10px 8px 16px",
            minHeight: 34,
          }}
        >
          <span
            style={{
              fontSize: 10,
              letterSpacing: ".18em",
              color: done ? "#75798c" : started ? "#7fd1a8" : "#b5abfc",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {label}
          </span>
          {home.week != null ? (
            <span style={{ fontSize: 11, color: "#75798c", flex: "0 0 auto" }}>
              Week {home.week}
            </span>
          ) : null}

          {count > 1 ? (
            <div
              style={{
                marginLeft: "auto",
                display: "flex",
                alignItems: "center",
                gap: 2,
                flex: "0 0 auto",
                whiteSpace: "nowrap",
              }}
            >
              <Arrow label="Previous matchup" onClick={() => setStep(step - 1)}>
                ‹
              </Arrow>
              {/* Where you are in the week, and a way back. The count is the
                  only thing saying there is more than one card here, so it
                  stays even on the game you started on. */}
              <button
                onClick={() => setStep(0)}
                disabled={step === 0}
                aria-label="Back to your own matchup"
                style={{
                  minHeight: 34,
                  minWidth: 38,
                  padding: 0,
                  border: 0,
                  background: "transparent",
                  font: "inherit",
                  fontSize: 10.5,
                  letterSpacing: ".1em",
                  fontVariantNumeric: "tabular-nums",
                  color: step === 0 ? "#75798c" : "#b5abfc",
                  cursor: step === 0 ? "default" : "pointer",
                }}
              >
                {at + 1}/{count}
              </button>
              <Arrow label="Next matchup" onClick={() => setStep(step + 1)}>
                ›
              </Arrow>
            </div>
          ) : null}
        </div>

        <Side
          key={game.home.id}
          side={game.home}
          logo={logos[game.home.id] ?? null}
          score={homeScore}
          winning={homeScore != null && awayScore != null && homeScore >= awayScore}
          mine={game.home.id === home.meId}
        />
        <Side
          key={game.away.id}
          side={game.away}
          logo={logos[game.away.id] ?? null}
          score={awayScore}
          winning={homeScore != null && awayScore != null && awayScore >= homeScore}
          mine={game.away.id === home.meId}
        />

        {/* Only once there is a game. Before kickoff the two scores are
            absent, and a bar drawn from nothing is a dead heat nobody is in. */}
        {homeScore != null && awayScore != null ? (
          <ScoreBar
            mine={game.away.id === home.meId ? awayScore : homeScore}
            theirs={game.away.id === home.meId ? homeScore : awayScore}
            neutral={!game.mine}
            final={done}
          />
        ) : null}
      </div>

      {/* The way down into a game, player by player. Only for your own: the
          lineup screen is built around you against an opponent, so there is no
          honest place to send somebody looking at two other franchises — the
          season page is where those are read in full. */}
      <div style={{ marginTop: 10, fontSize: 11, display: "flex", gap: 16, flexWrap: "wrap" }}>
        <Link
          href={game.mine ? "/lineup" : "/matchups"}
          style={{
            color: "#b5abfc",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            minHeight: 34,
          }}
        >
          {game.mine ? "Both lineups, player by player →" : "The whole season →"}
        </Link>
      </div>
    </>
  );
}

/** One step through the week. Thumb-sized, because it is pressed repeatedly. */
function Arrow({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        minWidth: 34,
        minHeight: 34,
        border: "1px solid rgba(145,132,217,.3)",
        borderRadius: "var(--radius-sm)",
        background: "transparent",
        color: "#b5abfc",
        font: "inherit",
        fontSize: 16,
        lineHeight: 1,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}
