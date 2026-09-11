/** The shape of /api/home, shared by the panels that render it. */

export interface HomeSide {
  id: string;
  slot: string;
  name: string;
  franchise: string;
  total: number;
}

export interface HomeGame {
  final: boolean;
  home: HomeSide;
  away: HomeSide;
  mine: boolean;
}

export interface Leader {
  position: string;
  player: {
    name: string;
    team: string;
    points: number;
    franchise: string | null;
    managerSlot: string | null;
  } | null;
}

export interface PowerRow {
  id: string;
  slot: string;
  franchise: string;
  name: string;
  rank: number;
  rating: number;
  wins: number;
  losses: number;
  ties: number;
  pointsFor: number;
  /**
   * Places gained since the last graded week — positive is up. Null before
   * anything has been graded, and null for a franchise that has not moved.
   */
  movement: number | null;
  /** The average age of the roster's skill players. Null for an empty one. */
  avgAge: number | null;
  mine: boolean;
}

/** One of the next five weeks, from this manager's side. */
export interface Upcoming {
  week: number;
  atHome: boolean;
  /** The week is being played, so the totals are a scoreboard not a forecast. */
  live: boolean;
  opponent: {
    id: string;
    franchise: string;
    name: string;
    record: { w: number; l: number; t: number };
  };
  mine: { total: number; record: { w: number; l: number; t: number } };
  theirs: { total: number };
  /** Your season's points minus theirs. */
  pointsForGap: number;
  margin: number;
  winProbability: number;
}

/** A trade it is this manager's turn to answer. */
export interface TradeAsk {
  id: string;
  /** The other franchise — whoever is waiting on the answer. */
  from: string;
  /** A counter coming back, rather than a first offer. */
  countered: boolean;
  /** What would come to this manager, and what would leave. */
  get: string[];
  give: string[];
  getPicks: number;
  givePicks: number;
}

/**
 * Somebody else's trade, waiting on this manager's vote.
 *
 * Written from the proposer outwards rather than flipped to suit the reader,
 * because the reader is in neither half of it — "Alpha sends, Bravo sends" is
 * how a bystander reads a deal.
 */
export interface TradeBallot {
  id: string;
  from: string;
  to: string;
  fromGives: string[];
  toGives: string[];
  fromGivesPicks: number;
  toGivesPicks: number;
  /** Where the count stands, and how many either way settles it. */
  vetoes: number;
  approvals: number;
  bar: number;
  /** When silence passes it, or null if the clock somehow never started. */
  closesAt: string | null;
}

export interface Home {
  meId: string;
  /** Offers waiting on an answer from this manager. Newest first. */
  trades: TradeAsk[];
  /** Other managers' deals this one still has a vote on. */
  ballots?: TradeBallot[];
  /** Empty starting slots and bye-week starters, this week, for this manager. */
  league: {
    name: string;
    season: number;
    /** When draft night is, or null if the commissioner has not set it. */
    draftAt?: string | null;
    /** Where the draft has got to, so the home page knows to stop mentioning it. */
    draftState?: string;
  } | null;
  week: number | null;
  games: HomeGame[];
  byes: { slot: string; franchise: string }[];
  /** A game on this week's NFL slate is in progress right now. */
  live: boolean;
  /** Anything on this week's slate has kicked off, so scores exist. */
  started: boolean;
  weekPhase: "upcoming" | "live" | "final";
  leaders: Leader[];
  leaderBasis: "scored" | "projected";
  power: PowerRow[];
  /** The next five fixtures, for the hero. */
  upcoming: Upcoming[];
  /** When the next NFL game starts, or null once they all have. */
  nextKickoff: string | null;
  played: boolean;
}
