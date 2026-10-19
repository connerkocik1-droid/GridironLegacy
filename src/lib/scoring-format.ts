/**
 * Which of the three reception rules a league plays, and what a catch is
 * worth under each.
 *
 * Its own small module rather than a corner of scoring.ts because the answer
 * is needed in places that must stay light: the client store every page loads
 * (use-me), and the projection helper that the trade desk and the player board
 * run in the browser. Nothing here imports anything.
 *
 * The one table of what a catch is worth. The scorer reads it, and so do the
 * projections — which is the point. Projections used to carry a hard-coded half
 * point per reception of their own, and when the league went to full PPR in
 * 0038 the scorer followed the setting and the projections did not: every
 * pass-catcher was under-projected by half a point a catch, every week, on
 * every screen that projects.
 */

export type ScoringFormat = "standard" | "half" | "ppr";

/** Points per reception, by format. */
export const RECEPTION_POINTS: Record<ScoringFormat, number> = {
  standard: 0,
  half: 0.5,
  ppr: 1,
};

/**
 * The format a league plays when its settings say nothing.
 *
 * Full PPR: what seed_league writes, and what the scorer, the game page and
 * the preseason check all assume for a league without the setting.
 */
export const DEFAULT_SCORING: ScoringFormat = "ppr";

export function isScoringFormat(value: unknown): value is ScoringFormat {
  return value === "standard" || value === "half" || value === "ppr";
}

/**
 * The league's format, read off its settings the way the scorer reads it.
 *
 * Takes anything, because settings arrive as untyped JSON from three
 * different routes, and answers the default for anything it does not
 * recognise rather than inventing a fourth format.
 */
export function scoringOf(settings: unknown): ScoringFormat {
  const value = (settings as { scoring?: unknown } | null | undefined)?.scoring;
  return isScoringFormat(value) ? value : DEFAULT_SCORING;
}
