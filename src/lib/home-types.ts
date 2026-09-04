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
  mine: boolean;
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

export interface Home {
  meId: string;
  /** Offers waiting on an answer from this manager. Newest first. */
  trades: TradeAsk[];
  /** Empty starting slots and bye-week starters, this week, for this manager. */
  league: { name: string; season: number } | null;
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
  played: boolean;
}
