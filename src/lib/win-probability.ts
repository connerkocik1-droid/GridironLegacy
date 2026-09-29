/**
 * The chance each side wins, which is a different question from who is ahead.
 *
 * ScoreBar deliberately refuses to answer this. Its bar is each side's share
 * of the two scores added together, and it says in its own comments that this
 * is not a win probability and is not offered as one — correctly, because at
 * one o'clock on a Sunday a manager leading 40-0 with two players left has a
 * share of 100% and a real chance closer to a coin toss.
 *
 * This is the actual question. A side's final score is what it has banked plus
 * what it still has to come, and only the second part is uncertain. So the
 * margin is modelled as a normal distribution: its mean is the difference of
 * the two projected finals, and its spread comes from the players who have not
 * finished yet. Everybody who has played is certainty; everybody who has not
 * is variance. As the afternoon goes on the variance drains away, the
 * probability hardens towards nought or one, and at the final whistle it is
 * simply who won.
 *
 * The one number that is a judgement rather than a measurement is SPREAD
 * below, and it is stated plainly rather than buried: a fantasy projection is
 * roughly right and weekly, and weekly outcomes scatter widely around it. This
 * is the one assumption in the model, it is a standard one, and it only ever
 * moves a probability towards or away from 50% — it can never make the model
 * claim the wrong leader.
 */

/**
 * How far a player's actual week typically lands from his projection, as a
 * fraction of that projection.
 *
 * A receiver projected for 12 does not score 12; he scores 3, or 24. Around
 * two thirds is the usual empirical figure for weekly fantasy scoring and it
 * is deliberately on the generous side, because a model that is too confident
 * too early is worse than one that hedges: the first tells somebody a game is
 * over when it is not.
 */
const SPREAD = 0.65;

export interface Outlook {
  /** Points already on the board — players whose games have finished. */
  scored: number;
  /** Projected points still to come from everybody who has not finished. */
  remaining: number;
  /** Where this side is expected to end up. */
  projected: number;
  /** The standard deviation of what is still to come. */
  sd: number;
  /** How many players have not finished. */
  yetToPlay: number;
  /** How many are on the field this second. */
  inPlay: number;
}

export interface Playable {
  points: number;
  projected: number;
  /** "pre" before kickoff, "in" while the game runs, "post" once it is over. */
  state?: "pre" | "in" | "post";
  /**
   * How much of his game is still to be played, 0 to 1 — read only while he
   * is on the field. The game clock where the mirror has it, the time since
   * kickoff where it does not (nfl-week.ts, gameLeft). Absent, the older
   * estimate stands: whatever of his projection he has not scored yet.
   */
  left?: number | null;
}

/**
 * Where one side stands.
 *
 * A player mid-game counts both ways and has to: what he has scored is banked,
 * and what he has left is the difference between his projection and his score,
 * never below nought. A running back on 18 against a projection of 12 has not
 * got minus six to come.
 */
export function outlookOf(entries: (Playable | null)[]): Outlook {
  let scored = 0;
  let remaining = 0;
  let variance = 0;
  let yetToPlay = 0;
  let inPlay = 0;

  for (const e of entries) {
    if (!e) continue;
    const state = e.state ?? "pre";

    if (state === "post") {
      scored += e.points;
      continue;
    }

    if (state === "in") {
      inPlay++;
      scored += e.points;

      if (e.left != null && Number.isFinite(e.left)) {
        // The clock says how much of his afternoon is left, and his projection
        // was for the whole of it. What he has banked is banked; what is still
        // to come is his projection's share of the minutes that remain.
        //
        // This is the case the older estimate got wrong. "Projection minus
        // points" treats a man on nought with two minutes left exactly like a
        // man on nought at kickoff — the whole projection still to come — so a
        // side leading late read as a coin toss until the last whistle.
        const share = Math.min(1, Math.max(0, e.left));
        const base = Math.max(0, e.projected);
        remaining += base * share;
        // A game's scoring arrives in separate pieces, so the uncertainty in
        // what is left shrinks with the square root of the time remaining
        // rather than in step with it — at kickoff this is exactly the spread
        // of a man yet to play, and it drains to nothing at the whistle.
        variance += (SPREAD * base) ** 2 * share;
        continue;
      }

      // No clock to read. What is left of him, which is less than his
      // projection and never negative. His remaining minutes carry
      // proportionally less spread.
      const left = Math.max(0, e.projected - e.points);
      remaining += left;
      variance += (SPREAD * left) ** 2;
      continue;
    }

    yetToPlay++;
    remaining += e.projected;
    variance += (SPREAD * e.projected) ** 2;
  }

  return {
    scored,
    remaining,
    projected: scored + remaining,
    sd: Math.sqrt(variance),
    yetToPlay,
    inPlay,
  };
}

/** Φ(z), by Abramowitz and Stegun 7.1.26 — accurate to about 1e-7. */
function normalCdf(z: number): number {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

/**
 * The chance the home side wins, from 0 to 1.
 *
 * `final` is not a shortcut for "no variance left" — it is the statement that
 * the week has been graded and the argument is over. A week can have every
 * game finished and still not be settled, and until it is settled the honest
 * answer comes from the same arithmetic as every other moment.
 */
export function winProbability(home: Outlook, away: Outlook, final = false): number {
  if (final) {
    if (home.scored > away.scored) return 1;
    if (home.scored < away.scored) return 0;
    return 0.5;
  }

  const margin = home.projected - away.projected;
  const sd = Math.hypot(home.sd, away.sd);

  // Nothing left to happen. Whoever is ahead has won, whatever the schedule
  // says, and a tie is a tie.
  if (sd < 1e-9) {
    if (margin > 0) return 1;
    if (margin < 0) return 0;
    return 0.5;
  }

  return normalCdf(margin / sd);
}

/**
 * The pair of percentages, as whole numbers that add to a hundred.
 *
 * Rounded together rather than separately: two independent roundings produce
 * "45% / 56%", which anybody can see is wrong and which quietly undermines
 * every other number on the card.
 */
export function asPercents(p: number): { home: number; away: number } {
  const home = Math.round(Math.min(1, Math.max(0, p)) * 100);
  return { home, away: 100 - home };
}
