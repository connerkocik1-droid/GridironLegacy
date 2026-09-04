"use client";

/**
 * The clock, felt rather than read.
 *
 * It was four digits that changed colour with fifteen seconds left. That is
 * enough to know the time and not enough to feel it — and draft night is the
 * one evening of the year where the feeling is the point. A manager glancing
 * up from the player list has to take in "how long have I got" in about a
 * tenth of a second, and a number is the slowest possible way to say it.
 *
 * So the time is also a length. The bar drains for the whole pick rather than
 * only at the end, which means there is never a moment where the screen looks
 * calm and is not: at forty seconds it is visibly half gone.
 *
 * Three states rather than two. Calm, then amber at fifteen seconds, then red
 * at five — and the pulse arrives only in that last five, because a clock that
 * throbs for ninety seconds is a clock nobody looks at by round three.
 */

interface Props {
  /** Seconds left on this pick. */
  remaining: number;
  /** What this round's clock started at, so the bar knows what full is. */
  total: number;
  /** Whether the manager looking at it is the one on the clock. */
  mine: boolean;
}

const AMBER = 15;
const RED = 5;

export default function PickClock({ remaining, total, mine }: Props) {
  const level = remaining <= RED ? "red" : remaining <= AMBER ? "amber" : "calm";

  const colour = level === "red" ? "#e0908f" : level === "amber" ? "#e0b573" : "#d2cefd";

  // Guarded: a clock whose round length is unknown would divide by nought and
  // draw a bar of NaN, which renders as an empty track and reads as "no time
  // left" — the most alarming possible way to fail.
  const left = total > 0 ? Math.max(0, Math.min(1, remaining / total)) : 1;

  return (
    <div style={{ textAlign: "right", minWidth: 128 }}>
      <div
        className={level === "red" ? "gl-clock-urgent" : undefined}
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 44,
          lineHeight: 1.05,
          color: colour,
          fontVariantNumeric: "tabular-nums",
          transition: "color 300ms ease",
        }}
      >
        {Math.floor(remaining / 60)}:{String(remaining % 60).padStart(2, "0")}
      </div>

      {/* The same number as a length. Drains from the first second, so the
          screen never looks calmer than the clock actually is. */}
      <div
        aria-hidden
        style={{
          height: 3,
          borderRadius: 2,
          background: "rgba(145,132,217,.18)",
          overflow: "hidden",
          margin: "5px 0 5px auto",
          width: "100%",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${left * 100}%`,
            // Anchored left, so the bar retreats rightward as the time goes.
            // Anchored right it read as filling up rather than draining, which
            // is the opposite of what a clock is doing.
            borderRadius: 2,
            background: colour,
            // Matched to the tick it is drawn from, so it slides rather than
            // stepping. Colour is slower, so a change of state reads as a
            // change of mood rather than a flicker.
            transition: "width 260ms linear, background 300ms ease",
          }}
        />
      </div>

      <div
        style={{
          fontSize: 10,
          letterSpacing: ".2em",
          color: mine ? colour : "#75798c",
        }}
      >
        {mine ? "YOUR PICK" : "REMAINING"}
      </div>
    </div>
  );
}
