"use client";

import { useRef, useState } from "react";
import Skeleton from "./Skeleton";
import Link from "next/link";
import TeamCrest from "./TeamCrest";
import LiveNumber from "./LiveNumber";
import ScoreBar from "./ScoreBar";
import { firstName } from "@/lib/first-name";
import { useLogos } from "@/lib/use-logos";
import type { Home, HomeSide } from "@/lib/home-types";

const card: React.CSSProperties = {
  border: "1px solid rgb(var(--accent-bright-rgb) / .4)",
  borderRadius: "var(--radius-lg)",
  background: "rgb(var(--accent-rgb) / .1)",
  overflow: "hidden",
};

function Side({
  side,
  logo,
  score,
  winning,
  mine,
  record,
}: {
  side: HomeSide;
  logo: string | null;
  /** Absent before the week starts: there is no score to show, not a zero. */
  score: number | null;
  winning: boolean;
  mine: boolean;
  /** "12-0", or absent before the league has graded anything. */
  record?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderTop: "1px solid rgb(var(--accent-rgb) / .14)",
      }}
    >
      <TeamCrest franchise={side.franchise} logo={logo} size={38} shape="box" fallback="initials" />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 16,
            letterSpacing: "-.01em",
            color: mine ? "var(--accent-text)" : "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {side.franchise}
        </div>
        {/* The record belongs on a scoreboard. Without it a fixture is two
            names and two numbers, and the one thing that makes the second
            number mean anything — whether this is the league's best team or
            its worst — was two pages away. It matters most on the games that
            are not yours, which is most of what the arrows step through. */}
        <div style={{ fontSize: 11.5, color: "var(--text-dim)", marginTop: 2 }}>
          {firstName(side.name)}
          {mine ? <span style={{ color: "var(--accent-link)" }}> · you</span> : null}
          {record ? ` · ${record}` : null}
        </div>
      </div>
      {score != null ? (
        <LiveNumber
          value={score}
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 26,
            color: winning ? "var(--text)" : "var(--text-muted)",
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
 * The arrows step through every fixture in the week without leaving the page,
 * and on a phone so does a swipe across the card — the arrows are what says
 * the week is there, the swipe is how it actually gets read on a sofa.
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

  // Which way the last step went, so the card can come in from that side.
  // Zero on the first render, where there is nothing to have moved from.
  const [dir, setDir] = useState(0);
  const touch = useRef<{ x: number; y: number } | null>(null);

  function go(by: number) {
    setDir(by);
    setStep(step + by);
  }

  if (!home) {
    return <Skeleton rows={2} title={false} style={{ padding: 0 }} />;
  }

  // Every franchise's record, from the power table the feed already carries.
  // Absent before anything has been graded, where "0-0" beside both names is
  // noise rather than information.
  const records = new Map<string, string>();
  if (home.played) {
    for (const row of home.power) {
      records.set(row.id, `${row.wins}-${row.losses}${row.ties ? `-${row.ties}` : ""}`);
    }
  }

  const count = home.games.length;
  const mineAt = home.games.findIndex((g) => g.mine);
  const at = count ? (((mineAt < 0 ? 0 : mineAt) + step) % count + count) % count : 0;
  const game = count ? home.games[at] : undefined;

  if (!game) {
    const onBye = home.week != null && home.games.length > 0;
    return (
      <div style={{ ...card, padding: "14px 16px", fontSize: 12.5, color: "var(--text-muted)" }}>
        {onBye
          ? "No fixture this week — you have a bye."
          : "No fixtures yet. The commissioner builds the schedule once every franchise is claimed."}
      </div>
    );
  }

  // The best score in the league this week, which is the question straight
  // after "am I winning" and was two pages away. Only once something has been
  // scored: before kickoff the highest of twelve noughts is a nought, and
  // naming a franchise as its owner is a joke at their expense.
  const high = (() => {
    if (!home.started) return null;
    let best: { franchise: string; total: number; mine: boolean } | null = null;
    for (const g of home.games) {
      for (const side of [g.home, g.away]) {
        if (!best || side.total > best.total) {
          best = { franchise: side.franchise, total: side.total, mine: side.id === home.meId };
        }
      }
    }
    return best && best.total > 0 ? best : null;
  })();

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
      <div
        style={card}
        onTouchStart={(e) => {
          const t = e.touches[0];
          touch.current = t ? { x: t.clientX, y: t.clientY } : null;
        }}
        // A swipe, not a scroll that drifted. Far enough sideways to be
        // deliberate, and more sideways than down — a thumb flicking the page
        // up past this card is not asking for next week's fixture.
        onTouchEnd={(e) => {
          const from = touch.current;
          touch.current = null;
          const t = e.changedTouches[0];
          if (!from || !t || count < 2) return;
          const dx = t.clientX - from.x;
          const dy = t.clientY - from.y;
          if (Math.abs(dx) < 44 || Math.abs(dx) < Math.abs(dy) * 1.4) return;
          go(dx < 0 ? 1 : -1);
        }}
      >
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
          {/* A dot while a game on the slate is actually being played. The
              scores already move on their own, but only if you happen to be
              looking when one does — this is the difference between a page
              that is live and a page that looks the same as it did on
              Thursday. */}
          {home.live && !done ? (
            <span
              className="gl-live-dot"
              aria-hidden
              style={{
                flex: "0 0 auto",
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "var(--good)",
              }}
            />
          ) : null}
          <span
            style={{
              fontSize: 10,
              letterSpacing: ".18em",
              color: done ? "var(--text-dim)" : started ? "var(--good)" : "var(--accent-link)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              minWidth: 0,
            }}
          >
            {label}
          </span>
          {home.week != null ? (
            <span style={{ fontSize: 11, color: "var(--text-dim)", flex: "0 0 auto" }}>
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
              <Arrow label="Previous matchup" onClick={() => go(-1)}>
                ‹
              </Arrow>
              {/* Where you are in the week, and a way back. The count is the
                  only thing saying there is more than one card here, so it
                  stays even on the game you started on. */}
              <button
                onClick={() => go(-step)}
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
                  color: step === 0 ? "var(--text-dim)" : "var(--accent-link)",
                  cursor: step === 0 ? "default" : "pointer",
                }}
              >
                {at + 1}/{count}
              </button>
              <Arrow label="Next matchup" onClick={() => go(1)}>
                ›
              </Arrow>
            </div>
          ) : null}
        </div>

        {/* Keyed on which fixture this is, so the two rows and the bar are
            replaced — and the animation restarts — on every step. The card's
            own header does not move: the week is not what changed. */}
        <div
          key={at}
          className={dir === 0 ? undefined : dir > 0 ? "gl-step-next" : "gl-step-prev"}
        >
        <Side
          key={game.home.id}
          side={game.home}
          logo={logos[game.home.id] ?? null}
          score={homeScore}
          winning={homeScore != null && awayScore != null && homeScore >= awayScore}
          mine={game.home.id === home.meId}
          record={records.get(game.home.id)}
        />
        <Side
          key={game.away.id}
          side={game.away}
          logo={logos[game.away.id] ?? null}
          score={awayScore}
          winning={homeScore != null && awayScore != null && awayScore >= homeScore}
          mine={game.away.id === home.meId}
          record={records.get(game.away.id)}
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
      </div>

      {/* The way down into a game, player by player. Only for your own: the
          lineup screen is built around you against an opponent, so there is no
          honest place to send somebody looking at two other franchises — the
          season page is where those are read in full. */}
      {/* The high score and the way in, on one line where there is room and
          stacked tight where there is not. */}
      <div
        style={{
          marginTop: 8,
          fontSize: 11,
          display: "flex",
          alignItems: "center",
          gap: 16,
          rowGap: 0,
          flexWrap: "wrap",
        }}
      >
        {high ? (
          <span
            style={{
              fontSize: 11,
              color: "var(--text-dim)",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              minHeight: 34,
            }}
          >
            <span style={{ letterSpacing: ".14em", fontSize: 10 }}>HIGH THIS WEEK</span>
            <span style={{ color: high.mine ? "var(--accent-link)" : "var(--text-3)" }}>
              {high.franchise} {high.total.toFixed(1)}
              {high.mine ? " · you" : ""}
            </span>
          </span>
        ) : null}

        <Link
          href={game.mine ? "/lineup" : "/matchups"}
          style={{
            color: "var(--accent-link)",
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
        border: "1px solid rgb(var(--accent-rgb) / .3)",
        borderRadius: "var(--radius-sm)",
        background: "transparent",
        color: "var(--accent-link)",
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
