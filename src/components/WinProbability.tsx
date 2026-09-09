"use client";

import { asPercents } from "@/lib/win-probability";

/**
 * Two bars growing out of a shared middle, and the odds at either end.
 *
 * This is the one number on a matchup that answers the question a manager
 * actually has. ScoreBar next door draws each side's share of the points, which
 * is a fine picture of the gap and a terrible answer to "am I winning" — at one
 * o'clock a side leading 40-0 with everything still to come owns 100% of that
 * bar and rather less than 100% of the game.
 *
 * Both bars fill outward from the centre so the two are read as one quantity
 * split between them rather than as two independent meters. The leader's bar is
 * the lit one; a game inside a couple of points either way lights neither,
 * because a 51/49 game drawn with one side glowing looks decided and is not.
 */
export default function WinProbability({
  /** The chance the left-hand side wins, 0 to 1. */
  p,
  /** The week is settled, so this is a result and not a forecast. */
  final = false,
  label = true,
  /**
   * The margin, in words — "up 6.4", "Thunderbolts by 2.8". Sits on the same
   * line as the caption rather than getting a bar of its own: this screen used
   * to draw two bars one above the other, a win probability and a share of the
   * points, which is two pictures of one game and neither of them clearer for
   * the company.
   */
  note = "",
}: {
  p: number;
  final?: boolean;
  label?: boolean;
  note?: string;
}) {
  const { home, away } = asPercents(p);

  // Inside this band it is a coin toss, and colouring one side would say
  // otherwise. Not applied to a finished game, where 100/0 is the fact.
  const tooClose = !final && Math.abs(home - 50) < 3;
  const homeLeads = home > away;

  const lit = (mine: boolean) =>
    tooClose ? "rgb(var(--accent-bright-rgb) / .45)" : mine ? "var(--good)" : "rgb(var(--accent-bright-rgb) / .35)";

  const bar = (pct: number, mine: boolean, side: "left" | "right"): React.CSSProperties => ({
    height: 6,
    borderRadius: 3,
    background: lit(mine),
    width: `${pct}%`,
    // Grown from the middle: the left bar is pinned to its right edge.
    marginLeft: side === "left" ? "auto" : undefined,
    transition: "width .5s ease, background .3s ease",
  });

  const pctText: React.CSSProperties = {
    fontSize: 11,
    fontVariantNumeric: "tabular-nums",
    color: "var(--text-muted)",
    flex: "0 0 auto",
    minWidth: 30,
  };

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ ...pctText, textAlign: "left" }}>{home}%</span>
        <div style={{ flex: 1, display: "flex", alignItems: "center", gap: 4, minWidth: 0 }}>
          <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
            <div style={bar(home, homeLeads, "left")} />
          </div>
          <div style={{ flex: 1, minWidth: 0, display: "flex" }}>
            <div style={bar(away, !homeLeads, "right")} />
          </div>
        </div>
        <span style={{ ...pctText, textAlign: "right" }}>{away}%</span>
      </div>
      {label ? (
        <div
          style={{
            textAlign: "center",
            fontSize: 10,
            letterSpacing: ".18em",
            color: "var(--text-dim)",
            marginTop: 5,
          }}
        >
          {final ? "RESULT" : "WIN PROBABILITY"}
          {note ? <span style={{ color: "var(--text-dim)" }}>{` · ${note}`}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
