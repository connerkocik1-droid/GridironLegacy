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

export interface Home {
  meId: string;
  league: { name: string; season: number } | null;
  week: number | null;
  games: HomeGame[];
  byes: { slot: string; franchise: string }[];
  live: boolean;
  leaders: Leader[];
  leaderBasis: "scored" | "projected";
  power: PowerRow[];
  played: boolean;
}
