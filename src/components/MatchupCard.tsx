"use client";

import Link from "next/link";
import TeamCrest from "./TeamCrest";
import LiveNumber from "./LiveNumber";
import WinProbability from "./WinProbability";

/**
 * One fixture, as a card you press.
 *
 * Two things were wrong with what this replaces, and the second was the worse
 * one. The card showed two names and two numbers, which is a scoreboard and
 * not a reason to look; and each name was a link to *your* team against that
 * franchise, so pressing a game between two other managers laid your own
 * roster out beside one of them. The fixture on the card and the screen it
 * opened were different games.
 *
 * So: the whole card is one link, and it goes to the game drawn on it. Yours
 * opens as yours; anybody else's opens as itself.
 *
 * What is on it is what somebody glancing at a phone on a Sunday wants —
 * where the score is, where it is expected to end up, what the chances are,
 * and how much football each side has left. The last of those is the one that
 * makes a scoreboard readable: forty points behind with nine to play is a
 * different afternoon from forty behind with none.
 */

export interface CardSide {
  id: string;
  name: string;
  claimed: boolean;
  franchise: string;
  points: number | null;
  projected?: number | null;
  yetToPlay?: number | null;
  inPlay?: number | null;
  record?: { w: number; l: number; t: number };
}

export interface CardGame {
  week: number;
  final: boolean;
  live: boolean;
  divisional: boolean;
  mine: boolean;
  home: CardSide;
  away: CardSide;
  winProbability?: number | null;
}

/** "0-0", or "0-0-1" only when somebody has actually tied. */
function recordText(record?: { w: number; l: number; t: number }): string {
  if (!record) return "";
  return `${record.w}-${record.l}${record.t ? `-${record.t}` : ""}`;
}

function Side({
  side,
  logo,
  align,
  leading,
  faded,
}: {
  side: CardSide;
  logo: string | null;
  align: "left" | "right";
  leading: boolean;
  faded: boolean;
}) {
  const right = align === "right";
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          display: "flex",
          flexDirection: right ? "row-reverse" : "row",
          alignItems: "center",
          gap: 10,
          minWidth: 0,
        }}
      >
        <TeamCrest franchise={side.franchise} logo={logo} size={40} shape="circle" />
        <div style={{ minWidth: 0, textAlign: align }}>
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 26,
              lineHeight: 1.1,
              fontVariantNumeric: "tabular-nums",
              color: faded ? "var(--text-quiet)" : leading ? "var(--accent-text)" : "var(--text)",
            }}
          >
            {side.points == null ? "—" : <LiveNumber key={side.id} value={side.points} />}
          </div>
          {/* Where it is expected to finish. Grey and small on purpose: it is
              context for the number above it, not a second score. */}
          {side.projected != null ? (
            <div
              style={{
                fontSize: 11,
                color: "var(--text-dim)",
                fontVariantNumeric: "tabular-nums",
                marginTop: 1,
              }}
            >
              {side.projected.toFixed(1)}
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ textAlign: align, marginTop: 9, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 14,
            color: faded ? "var(--text-quiet)" : "var(--text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {side.franchise}
        </div>
        <div
          style={{
            fontSize: 10.5,
            color: side.claimed ? "var(--text-dim)" : "var(--text-faint)",
            marginTop: 2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {side.claimed ? side.name : "Open"}
          {side.record ? ` · ${recordText(side.record)}` : ""}
        </div>
        {/* How much football is left. Only while a week is actually running:
            before kickoff "yet to play (9)" is every card in the league
            saying the same thing, and after the whistle it is nothing. */}
        {side.yetToPlay != null && (side.yetToPlay > 0 || (side.inPlay ?? 0) > 0) ? (
          <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 3 }}>
            {side.inPlay ? `${side.inPlay} in play · ` : ""}
            {side.yetToPlay} to play
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function MatchupCard({
  game,
  logos,
  meId,
  highlight = false,
}: {
  game: CardGame;
  logos: Record<string, string>;
  meId: string;
  highlight?: boolean;
}) {
  const { home, away } = game;

  // Your own game is read from your own side, whichever way the schedule
  // wrote it. Home and away are a coin toss in a fantasy league — nobody
  // travels — and finding yourself on the right half of your own card is a
  // small tax paid twelve times a season.
  const flip = game.mine && away.id === meId;
  const left = flip ? away : home;
  const right = flip ? home : away;

  const leftLeads = (left.points ?? 0) > (right.points ?? 0);
  const rightLeads = (right.points ?? 0) > (left.points ?? 0);
  const settled = game.final;

  // The whole card is the link, and it names both sides. Without `home` this
  // is "me against them", which is the bug this component exists to end.
  const href = game.mine
    ? `/lineup?week=${game.week}`
    : `/lineup?home=${encodeURIComponent(left.id)}&opponent=${encodeURIComponent(right.id)}&week=${game.week}`;

  const chance =
    game.winProbability == null
      ? null
      : // The bar is drawn left-to-right, so it has to be the left side's
        // chance — which is the other side's when the card has been flipped.
        flip
        ? 1 - game.winProbability
        : game.winProbability;

  return (
    <Link
      href={href}
      aria-label={`Week ${game.week}: ${left.franchise} versus ${right.franchise}`}
      style={{
        display: "block",
        textDecoration: "none",
        color: "inherit",
        border: `1px solid ${highlight ? "rgb(var(--accent-bright-rgb) / .5)" : "rgb(var(--accent-rgb) / .2)"}`,
        borderRadius: "var(--radius-md)",
        background: highlight ? "rgb(var(--accent-rgb) / .1)" : "rgb(var(--surface-rgb) / .55)",
        padding: "11px 14px 14px",
        // A card is a thumb target, not a paragraph with a link in it.
        WebkitTapHighlightColor: "transparent",
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
          marginBottom: 11,
        }}
      >
        WEEK {game.week}
        {game.divisional ? <span style={{ color: "var(--accent-link)" }}>· DIVISION</span> : null}
        <span style={{ marginLeft: "auto", color: game.live ? "var(--good)" : "var(--text-dim)" }}>
          {settled ? "FINAL" : game.live ? "LIVE" : "TO COME"}
        </span>
      </div>

      <div
        style={{
          display: "grid",
          // minmax(0,1fr) rather than 1fr: an implicit track will not shrink
          // below its content, and a long franchise name pushes the card
          // sideways off a 320px screen.
          gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)",
          gap: 12,
          alignItems: "start",
        }}
      >
        <Side
          side={left}
          logo={logos[left.id] ?? null}
          align="left"
          leading={leftLeads}
          faded={settled && rightLeads}
        />
        <Side
          side={right}
          logo={logos[right.id] ?? null}
          align="right"
          leading={rightLeads}
          faded={settled && leftLeads}
        />
      </div>

      {chance != null ? (
        <div style={{ marginTop: 12 }}>
          <WinProbability p={chance} final={settled} />
        </div>
      ) : null}
    </Link>
  );
}
