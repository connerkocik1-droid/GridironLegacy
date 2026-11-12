/**
 * The playoff picture: who is in if the season ended today, who has made sure
 * of it, and who can no longer get there.
 *
 * The order comes from the database's seeding() — division winners first, then
 * the best records left, win percentage then points for then slot — so this
 * page and the bracket start_playoffs draws can never disagree about a seed.
 * What is worked out here is only what that order cannot say: whether it can
 * still change.
 *
 * Clinching and elimination are on wins alone, with a tie counted as half. A
 * tiebreak on points is not settled until the last game is, so a team that can
 * only be caught on a tiebreak is never called safe, and a team that can only
 * catch up on one is never called out. Both marks are therefore certain: a
 * team marked clinched is in, and a team marked eliminated is out, whatever
 * happens in the weeks left.
 */

export interface PictureTeam {
  id: string;
  division: string | null;
  wins: number;
  losses: number;
  ties: number;
  /** Regular-season games still to be settled. */
  remaining: number;
}

export type PictureStatus = "bye" | "division" | "clinched" | "in" | "out" | "eliminated";

export interface PictureRow {
  id: string;
  seed: number;
  /** In the field if the season ended today. */
  inField: boolean;
  /** Would have a first-round bye if the season ended today. */
  bye: boolean;
  /** Leads its division today. */
  divisionLeader: boolean;
  /** Certain, whatever happens in the weeks left: clinched a bye, the division, a place; or eliminated. */
  status: PictureStatus;
  /** The standard mark beside the name: z a bye, y the division, x a place, e eliminated. */
  mark: "z" | "y" | "x" | "e" | null;
  /** Wins behind the last team in, for a team outside; null for a team in. */
  behind: number | null;
}

export interface BracketShape {
  field: number;
  rounds: number;
  /** Top seeds who sit the first round out, to make the second a power of two. */
  byes: number;
}

/** How many rounds a field needs, and how many byes the top seeds get. */
export function bracketShape(field: number): BracketShape {
  const f = Math.max(2, field);
  const rounds = Math.max(1, Math.ceil(Math.log2(f)));
  return { field: f, rounds, byes: 2 ** rounds - f };
}

/** "Final", "Semi-finals", "Quarter-finals", "Wild card" — named from the end, so a round never changes name. */
export function roundName(round: number, rounds: number): string {
  const fromEnd = rounds - round;
  if (fromEnd === 0) return "Championship";
  if (fromEnd === 1) return "Semi-finals";
  if (fromEnd === 2) return round === 1 ? "Wild card" : "Quarter-finals";
  return `Round ${round}`;
}

/** First-round pairings by seed, from the outside in, after the byes. */
export function firstRound(shape: BracketShape): [number, number][] {
  const games: [number, number][] = [];
  for (let lo = shape.byes + 1, hi = shape.field; lo < hi; lo++, hi--) games.push([lo, hi]);
  return games;
}

const banked = (t: PictureTeam) => t.wins + t.ties / 2;
const ceiling = (t: PictureTeam) => banked(t) + t.remaining;

/**
 * The picture, from the teams and the order seeding() puts them in.
 *
 * `order` is every franchise's id, best seed first.
 */
export function playoffPicture(teams: PictureTeam[], order: string[], fieldSize: number): { shape: BracketShape; rows: PictureRow[] } {
  const shape = bracketShape(Math.min(fieldSize, teams.length));
  const byId = new Map(teams.map((t) => [t.id, t]));
  const divisions = new Map<string, PictureTeam[]>();
  for (const t of teams) {
    const key = t.division ?? "";
    divisions.set(key, [...(divisions.get(key) ?? []), t]);
  }
  const divisionCount = divisions.size;

  // Today's division leaders, the way seeding() picks them: the first of each
  // division in the seed order.
  const leaders = new Set<string>();
  const seen = new Set<string>();
  for (const id of order) {
    const d = byId.get(id)?.division ?? "";
    if (!seen.has(d)) {
      seen.add(d);
      leaders.add(id);
    }
  }

  const rivals = (a: PictureTeam) => (divisions.get(a.division ?? "") ?? []).filter((b) => b.id !== a.id);
  const otherDivisions = (a: PictureTeam) => [...divisions.entries()].filter(([d]) => d !== (a.division ?? "")).map(([, ts]) => ts);

  /** Nobody in the division can reach this team's wins already banked. */
  const clinchedDivision = (a: PictureTeam) => rivals(a).every((b) => ceiling(b) < banked(a));

  /**
   * The most teams that could yet finish ahead of this one: everyone who can
   * still reach its wins, and a winner from every other division that can't,
   * since a division winner is seeded ahead whatever its record.
   */
  const mostAhead = (a: PictureTeam) =>
    teams.filter((b) => b.id !== a.id && ceiling(b) >= banked(a)).length +
    otherDivisions(a).filter((ts) => ts.every((b) => ceiling(b) < banked(a))).length;

  /**
   * The fewest teams certain to finish ahead: everyone already past this
   * team's best possible finish, and a winner from every other division where
   * nobody is (that division's winner is seeded ahead regardless).
   */
  const leastAhead = (a: PictureTeam) =>
    teams.filter((b) => b.id !== a.id && banked(b) > ceiling(a)).length +
    otherDivisions(a).filter((ts) => ts.every((b) => banked(b) <= ceiling(a))).length;

  const canWinDivision = (a: PictureTeam) => rivals(a).every((b) => banked(b) <= ceiling(a));

  const clinchedBye = (a: PictureTeam) => {
    if (shape.byes === 0) return false;
    if (shape.byes <= divisionCount) {
      // Byes go to division winners. This one must win its division and stay
      // ahead of all but byes-1 of the other divisions' possible winners.
      const threats = otherDivisions(a).filter((ts) => ts.some((b) => ceiling(b) >= banked(a))).length;
      return clinchedDivision(a) && threats < shape.byes;
    }
    return mostAhead(a) < shape.byes;
  };

  const lastIn = order[shape.field - 1] ? byId.get(order[shape.field - 1]) : undefined;

  // With nothing left to play the order is final, tiebreaks and all, so it is
  // the answer rather than something to reason about.
  const over = teams.every((t) => t.remaining === 0);
  const settled = (seed: number, id: string): PictureStatus =>
    seed > shape.field ? "eliminated" : seed <= shape.byes ? "bye" : leaders.has(id) ? "division" : "clinched";

  const rows: PictureRow[] = order.map((id, i) => {
    const a = byId.get(id)!;
    const seed = i + 1;
    const inField = seed <= shape.field;

    let status: PictureStatus;
    if (over) status = settled(seed, id);
    else if (clinchedBye(a)) status = "bye";
    else if (clinchedDivision(a)) status = "division";
    else if (mostAhead(a) < shape.field) status = "clinched";
    else if (!canWinDivision(a) && leastAhead(a) >= shape.field) status = "eliminated";
    else status = inField ? "in" : "out";

    return {
      id,
      seed,
      inField,
      bye: inField && seed <= shape.byes,
      divisionLeader: leaders.has(id),
      status,
      mark: status === "bye" ? "z" : status === "division" ? "y" : status === "clinched" ? "x" : status === "eliminated" ? "e" : null,
      behind: inField || !lastIn ? null : Math.max(0, banked(lastIn) - banked(a)),
    };
  });

  return { shape, rows };
}
