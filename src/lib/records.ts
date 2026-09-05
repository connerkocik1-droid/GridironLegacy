/**
 * What the season has been, rather than where it stands.
 *
 * A table says who is winning. It never says that somebody put a hundred and
 * seventy on the board in week three, or that the closest game of the year
 * was decided by two tenths, or that the manager in fourth has won five
 * straight and is coming for you. That is the half of a fantasy season people
 * actually talk about, and it is sitting unread in the schedule the app
 * already has.
 *
 * Everything here is derived from settled games only. A week in progress is
 * not a record — a score that is still moving would take the crown at four
 * o'clock and hand it back at half past.
 */

export interface RecordSide {
  id: string;
  franchise: string;
  points: number | null;
}

export interface RecordGame {
  week: number;
  final: boolean;
  home: RecordSide;
  away: RecordSide;
}

export interface Best {
  franchise: string;
  points: number;
  week: number;
}

export interface Margin {
  week: number;
  winner: string;
  loser: string;
  margin: number;
  winnerPoints: number;
  loserPoints: number;
}

export interface Streak {
  franchise: string;
  /** Positive for wins, negative for losses. Never zero. */
  run: number;
}

export interface Records {
  highest: Best | null;
  /** The most points anybody has scored and still lost. */
  unluckiest: Best | null;
  biggest: Margin | null;
  closest: Margin | null;
  /** The longest run going right now, won or lost. Ties end a run. */
  streak: Streak | null;
  /** Settled games this is drawn from, so a caller can stay quiet at nought. */
  played: number;
}

/** Both sides scored and the week is settled. */
function settled(g: RecordGame): boolean {
  return g.final && g.home.points != null && g.away.points != null;
}

export function records(games: RecordGame[]): Records {
  const done = games.filter(settled).sort((a, b) => a.week - b.week);

  let highest: Best | null = null;
  let unluckiest: Best | null = null;
  let biggest: Margin | null = null;
  let closest: Margin | null = null;

  for (const g of done) {
    const h = g.home.points as number;
    const a = g.away.points as number;

    for (const [side, points] of [
      [g.home, h],
      [g.away, a],
    ] as [RecordSide, number][]) {
      if (!highest || points > highest.points) {
        highest = { franchise: side.franchise, points, week: g.week };
      }
    }

    // A tie has no winner to name, so it is not a margin — and a margin of
    // nought is not the closest game, it is a different thing entirely.
    if (h === a) continue;

    const homeWon = h > a;
    const m: Margin = {
      week: g.week,
      winner: homeWon ? g.home.franchise : g.away.franchise,
      loser: homeWon ? g.away.franchise : g.home.franchise,
      margin: Math.abs(h - a),
      winnerPoints: Math.max(h, a),
      loserPoints: Math.min(h, a),
    };

    if (!biggest || m.margin > biggest.margin) biggest = m;
    if (!closest || m.margin < closest.margin) closest = m;

    const beaten = homeWon ? g.away : g.home;
    if (!unluckiest || m.loserPoints > unluckiest.points) {
      unluckiest = { franchise: beaten.franchise, points: m.loserPoints, week: g.week };
    }
  }

  return { highest, unluckiest, biggest, closest, streak: longestStreak(done), played: done.length };
}

/**
 * The longest run in progress, taken from each franchise's most recent games
 * backwards. A tie ends a run rather than extending it: "unbeaten in four" is
 * a different claim from "won four", and the second is the one worth printing.
 */
export function longestStreak(done: RecordGame[]): Streak | null {
  const results = new Map<string, { franchise: string; outcomes: number[] }>();

  for (const g of done) {
    const h = g.home.points as number;
    const a = g.away.points as number;
    const sides: [RecordSide, number][] = [
      [g.home, h === a ? 0 : h > a ? 1 : -1],
      [g.away, h === a ? 0 : a > h ? 1 : -1],
    ];
    for (const [side, outcome] of sides) {
      const row = results.get(side.id) ?? { franchise: side.franchise, outcomes: [] };
      row.outcomes.push(outcome);
      results.set(side.id, row);
    }
  }

  let best: Streak | null = null;
  for (const { franchise, outcomes } of results.values()) {
    const last = outcomes[outcomes.length - 1];
    if (!last) continue;

    let run = 0;
    for (let i = outcomes.length - 1; i >= 0 && outcomes[i] === last; i--) run++;

    const streak: Streak = { franchise, run: run * last };
    // Two or more, because "won one" is not a streak. Wins beat losses of the
    // same length: a league would rather read about a run than a slump.
    if (run < 2) continue;
    if (!best || run > Math.abs(best.run) || (run === Math.abs(best.run) && streak.run > best.run)) {
      best = streak;
    }
  }

  return best;
}
