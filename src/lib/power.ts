/**
 * Power rankings, from record and points scored.
 *
 * A league's table is honest but slow: nine weeks in, a 5-4 team that has
 * scored the most points in the league is plainly better than a 5-4 team that
 * has scraped every win. The ranking blends the two — what you have done and
 * how well you have done it — so it moves before the record does.
 *
 * Points are scaled against the best team in the league rather than an
 * absolute, because scoring depends on the league's own settings and there is
 * no meaningful outside yardstick.
 */

export interface Team {
  id: string;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
}

export interface Ranked extends Team {
  rank: number;
  /** 0–100. Comparable within one league and one call, not across leagues. */
  rating: number;
  winPct: number;
  games: number;
  /** Change against the same ranking a week ago, when one is known. */
  movement: number | null;
}

/** How much of the rating is the record; the rest is points scored. */
export const RECORD_WEIGHT = 0.6;

export function winPctOf(t: Team): number {
  const games = t.wins + t.losses + t.ties;
  if (!games) return 0;
  return (t.wins + t.ties * 0.5) / games;
}

/**
 * The teams in order, best first.
 *
 * Before any week has been graded every record is 0-0, and weighting a column
 * of zeroes would rank the league alphabetically. Until then the ranking is
 * points alone, which is the only thing that has actually happened.
 */
export function rank(teams: Team[], previous?: Map<string, number>): Ranked[] {
  const played = teams.some((t) => t.wins + t.losses + t.ties > 0);
  const best = Math.max(0, ...teams.map((t) => t.pointsFor));
  const recordWeight = played ? RECORD_WEIGHT : 0;

  const scored = teams.map((t) => {
    const winPct = winPctOf(t);
    const share = best > 0 ? t.pointsFor / best : 0;
    return {
      ...t,
      winPct,
      games: t.wins + t.losses + t.ties,
      rating: Math.round((recordWeight * winPct + (1 - recordWeight) * share) * 1000) / 10,
      rank: 0,
      movement: null as number | null,
    };
  });

  // Points break a tie on rating: two teams on the same rating differ only in
  // the rounding, and the one that scored more got there the harder way.
  scored.sort((a, b) => b.rating - a.rating || b.pointsFor - a.pointsFor);

  return scored.map((t, i) => {
    const rank = i + 1;
    const was = previous?.get(t.id);
    return { ...t, rank, movement: was == null ? null : was - rank };
  });
}
