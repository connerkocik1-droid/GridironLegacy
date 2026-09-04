"use client";

import LiveNumber from "./LiveNumber";

/**
 * How close it is, without doing the arithmetic.
 *
 * Two numbers on a card are a fact; the distance between them is the game.
 * A manager glancing at 104.6 and 98.2 has to subtract before they know
 * whether to keep watching — and that subtraction, done fifty times on a
 * Sunday, is the difference between a scoreboard and something you cannot put
 * down.
 *
 * So the gap gets drawn. The bar is each side's share of the two scores added
 * together, which is not a win probability and is not offered as one: it is
 * the same two numbers, in a form the eye reads in one movement instead of
 * two. A blowout looks like a blowout from across a room. A one-point game
 * looks like a one-point game, and the moment it turns over, the colour
 * crosses the middle.
 *
 * The width is a CSS transition rather than anything cleverer, so when a
 * touchdown lands the bar slides while the figure above it counts — one event,
 * said twice, which is how a thing becomes noticeable without being loud.
 */
export default function ScoreBar({
  mine,
  theirs,
  /** Turns the label off where the layout has no room for it. */
  showMargin = true,
  /**
   * Somebody else's game. "Up" and "down" mean nothing when neither side is
   * yours, so the margin is stated rather than taken personally.
   */
  neutral = false,
  /**
   * The week is over and this is the result rather than the state of play.
   * "Up 6.4" and "won by 6.4" are the same arithmetic and not remotely the
   * same sentence — one is a score, the other is the only thing anybody
   * remembers about a week.
   */
  final = false,
}: {
  mine: number;
  theirs: number;
  showMargin?: boolean;
  neutral?: boolean;
  final?: boolean;
}) {
  const total = mine + theirs;

  // Before anybody has scored there is no share to take, and half each would
  // draw a dead heat that nobody is in. It sits empty until there is a game.
  const share = total > 0 ? (mine / total) * 100 : 50;
  const margin = Math.abs(mine - theirs);
  const leading = mine > theirs;
  const level = mine === theirs;

  return (
    <div style={{ padding: "0 16px 12px" }}>
      <div
        style={{
          position: "relative",
          height: 6,
          borderRadius: 3,
          background: "rgb(var(--accent-rgb) / .16)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${total > 0 ? share : 0}%`,
            height: "100%",
            borderRadius: 3,
            background: leading
              ? "linear-gradient(90deg,var(--accent-mid),var(--accent-link))"
              : "linear-gradient(90deg,var(--accent-deep),var(--accent-soft))",
            transition: "width 650ms cubic-bezier(0.2,0,0,1), background 400ms ease",
          }}
        />
        {/* The halfway mark, so "ahead" and "behind" are visible rather than
            inferred from how full the bar looks. */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            left: "50%",
            top: -1,
            bottom: -1,
            width: 1,
            // Dark rather than light: it has to be visible against the empty
            // track and against the fill, and the fill is the lighter of the
            // two. A pale tick disappears exactly when the game is closest.
            background: "rgb(var(--shadow-rgb) / .8)",
          }}
        />
      </div>

      {showMargin && total > 0 ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginTop: 6,
            fontSize: 10.5,
            letterSpacing: ".1em",
            color: "var(--text-dim)",
          }}
        >
          <span
            style={{
              color: neutral
                ? "var(--text-muted)"
                : level
                  ? "var(--accent-link)"
                  : leading
                    ? "var(--good)"
                    : "var(--bad-soft)",
            }}
          >
            {level ? (
              final ? "TIED" : "LEVEL"
            ) : (
              <>
                {neutral
                  ? "BY "
                  : final
                    ? leading
                      ? "WON BY "
                      : "LOST BY "
                    : leading
                      ? "UP "
                      : "DOWN "}
                <LiveNumber value={margin} style={{ letterSpacing: "normal" }} />
              </>
            )}
          </span>
          <span>{Math.round(share)}% OF THE POINTS</span>
        </div>
      ) : null}
    </div>
  );
}
