/**
 * Where a player stands at his position, and what he is worth per week.
 *
 * "RB7, 14.2 a week" is the pair of numbers that decides whether somebody
 * stays on a roster. Total points cannot answer it — a man who has played
 * three games and a man who has played one are not comparable on a total — and
 * a rank without a rate cannot either, because RB7 in a shallow week is not
 * the same player as RB7 in a deep one.
 *
 * Ranked across the whole pool the league has scored, not across one roster.
 * "RB2 on your team" is a fact about your team; "RB2" is a fact about him.
 */

export interface Scored {
  name: string;
  position: string;
  points: number;
  games: number;
}

export interface Form {
  /** 1 for the best scorer at his position. */
  rank: number;
  ppg: number;
  games: number;
  /** The best points per game anybody at his position is managing. */
  bestPpg: number;
}

/**
 * Every scored player's standing at his own position.
 *
 * Ties break on name so the order does not shuffle between two reads of the
 * same table, which on a Sunday morning — when everybody is on nought — is
 * every read.
 */
export function positionForm(players: Scored[]): Map<string, Form> {
  const byPosition = new Map<string, Scored[]>();
  for (const p of players) {
    if (!p.position) continue;
    const group = byPosition.get(p.position) ?? [];
    group.push(p);
    byPosition.set(p.position, group);
  }

  const out = new Map<string, Form>();

  for (const group of byPosition.values()) {
    const ranked = [...group].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));

    // The yardstick the bar is drawn against: nobody at this position is doing
    // better than this per week.
    let bestPpg = 0;
    for (const p of group) {
      if (p.games > 0) bestPpg = Math.max(bestPpg, p.points / p.games);
    }

    ranked.forEach((p, i) => {
      out.set(p.name, {
        rank: i + 1,
        ppg: p.games > 0 ? Math.round((p.points / p.games) * 10) / 10 : 0,
        games: p.games,
        bestPpg: Math.round(bestPpg * 10) / 10,
      });
    });
  }

  return out;
}

export type Tier = "elite" | "starter" | "depth";

/**
 * Whether a rank is one the league actually starts.
 *
 * A rank means nothing on its own: RB20 is a weekly starter in a twelve-team
 * league that fields two backs and a flex, and unrostered in a six-team league
 * that fields one. So the tier is measured against how many of the position
 * the league puts on the field between them — the count that decides whether
 * a man is somebody's starter, somebody's bench, or nobody's.
 *
 * With no league to measure against, everybody is depth: better a chip that
 * claims nothing than one that claims a tier it invented.
 */
export function tierOf(rank: number, fielded: number): Tier {
  if (!Number.isFinite(rank) || rank < 1 || fielded < 1) return "depth";
  if (rank <= fielded / 2) return "elite";
  if (rank <= fielded) return "starter";
  return "depth";
}

/**
 * How many of a position the league fields between all of its teams.
 *
 * The flex counts towards every position that can fill it, because a flex spot
 * is a spot a running back can be started in — a league fielding two backs and
 * two flexes per team is a league where the third-best back on a roster plays.
 * Counting it towards each of them overstates the total slightly and that is
 * the right way to be wrong: a rank called startable that sometimes is not is
 * a smaller error than a starter labelled depth.
 */
const FLEX_TAKES = ["RB", "WR", "TE"];

export function fieldedAt(
  position: string,
  starters: Partial<Record<string, number>> | null | undefined,
  teams: number,
): number {
  if (!starters || teams < 1) return 0;
  const own = starters[position] ?? 0;
  const flex = FLEX_TAKES.includes(position) ? (starters.FLEX ?? 0) : 0;
  return (own + flex) * teams;
}
