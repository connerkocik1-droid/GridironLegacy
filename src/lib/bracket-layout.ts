import { bracketShape, roundName } from "./playoff-picture";

/**
 * Where everything goes in the bracket graphic: one column per round, each a
 * stack of boxes, every box two lines (or one, for a bye).
 *
 * The first round follows the standard bracket order — 1 v 8, 4 v 5 on top,
 * 2 v 7, 3 v 6 below — with the missing seeds of a smaller field turned into
 * byes, so a six-team bracket reads bye 1, 4 v 5, bye 2, 3 v 6. Later rounds
 * reseed, so their games are not fixed by the lines: a drawn game sits level
 * with whichever of its two teams came from higher up, and a round not drawn
 * yet shows the one thing that is certain — the team that rested — and TBD for
 * the rest.
 */

export interface BracketTeam {
  id: string;
  seed: number;
  /** Short name for a narrow box: the franchise's slot abbreviation. */
  abbr: string;
  franchise: string;
  mine?: boolean;
}

export interface BracketGameIn {
  id: string;
  week: number;
  round: number;
  final: boolean;
  winner: string | null;
  home: { id: string; points?: number };
  away: { id: string; points?: number };
}

export interface BracketLine {
  team: BracketTeam | null;
  points?: number;
  won?: boolean;
  lost?: boolean;
}

export interface BracketBox {
  key: string;
  /** A first-round bye: one team, no game. */
  bye?: boolean;
  /** The game, once it is drawn. */
  gameId?: string;
  week?: number;
  final?: boolean;
  lines: BracketLine[];
}

export interface BracketColumn {
  round: number;
  title: string;
  week: number | null;
  boxes: BracketBox[];
}

export interface BracketLayout {
  columns: BracketColumn[];
  champion: BracketTeam | null;
}

/** Seeds in standard bracket order for a bracket of `size` lines: 1, 8, 4, 5, 2, 7, 3, 6. */
export function bracketOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

export function bracketLayout(args: {
  teams: BracketTeam[];
  games: BracketGameIn[];
  /** The week of each round, when known. */
  roundWeeks?: (number | null)[];
  championId?: string | null;
}): BracketLayout {
  const field = args.teams.length;
  const shape = bracketShape(field);
  const bySeed = new Map(args.teams.map((t) => [t.seed, t]));
  const byId = new Map(args.teams.map((t) => [t.id, t]));
  const games = (round: number) => args.games.filter((g) => g.round === round);

  const lineOf = (g: BracketGameIn, side: "home" | "away"): BracketLine => {
    const id = g[side].id;
    const won = g.final && g.winner === id;
    return { team: byId.get(id) ?? null, points: g[side].points, won, lost: g.final && g.winner != null && !won };
  };
  const boxOf = (g: BracketGameIn, key: string): BracketBox => {
    // Better seed on top.
    const [a, b] = [lineOf(g, "home"), lineOf(g, "away")].sort((x, y) => (x.team?.seed ?? 99) - (y.team?.seed ?? 99));
    return { key, gameId: g.id, week: g.week, final: g.final, lines: [a, b] };
  };
  /** Who comes out of a box: a bye's team, or a settled game's winner. */
  const advancer = (box: BracketBox): BracketTeam | null =>
    box.bye ? box.lines[0].team : box.final ? (box.lines.find((l) => l.won)?.team ?? null) : null;

  const columns: BracketColumn[] = [];

  // Round one, in standard order.
  const order = bracketOrder(2 ** shape.rounds);
  const first: BracketBox[] = [];
  for (let i = 0; i < order.length; i += 2) {
    const [hi, lo] = [order[i], order[i + 1]].sort((a, b) => a - b);
    const top = bySeed.get(hi) ?? null;
    if (lo > field) {
      first.push({ key: `r1:${i / 2}`, bye: true, lines: [{ team: top }] });
      continue;
    }
    const drawn = games(1).find((g) => [g.home.id, g.away.id].includes(top?.id ?? "") && [g.home.id, g.away.id].includes(bySeed.get(lo)?.id ?? ""));
    first.push(drawn ? boxOf(drawn, `r1:${i / 2}`) : { key: `r1:${i / 2}`, lines: [{ team: top }, { team: bySeed.get(lo) ?? null }] });
  }
  columns.push({ round: 1, title: roundName(1, shape.rounds), week: args.roundWeeks?.[0] ?? null, boxes: first });

  for (let round = 2; round <= shape.rounds; round++) {
    const prev = columns[columns.length - 1].boxes;
    const count = 2 ** (shape.rounds - round);
    const drawn = games(round);
    let boxes: BracketBox[];
    if (drawn.length) {
      // Each game sits level with the higher of its two teams' previous boxes.
      const posOf = (id: string) => {
        const at = prev.findIndex((b) => b.lines.some((l) => l.team?.id === id));
        return at < 0 ? 99 : at;
      };
      boxes = [...drawn]
        .sort((a, b) => Math.min(posOf(a.home.id), posOf(a.away.id)) - Math.min(posOf(b.home.id), posOf(b.away.id)))
        .map((g, i) => boxOf(g, `r${round}:${i}`));
      while (boxes.length < count) boxes.push({ key: `r${round}:${boxes.length}`, lines: [{ team: null }, { team: null }] });
    } else {
      // Not drawn: the certain advancers in their place, TBD beside them.
      boxes = Array.from({ length: count }, (_, i) => {
        const known = [advancer(prev[2 * i]), advancer(prev[2 * i + 1])];
        // Only a team that rested is certainly here; a winner may be reseeded.
        const rested = [prev[2 * i], prev[2 * i + 1]].map((b, j) => (b?.bye ? known[j] : null));
        return { key: `r${round}:${i}`, lines: [{ team: rested[0] }, { team: rested[1] }] };
      });
    }
    columns.push({ round, title: roundName(round, shape.rounds), week: args.roundWeeks?.[round - 1] ?? null, boxes });
  }

  const finalBox = columns[columns.length - 1].boxes[0];
  const champion = (args.championId ? byId.get(args.championId) : null) ?? (finalBox ? advancer(finalBox) : null) ?? null;
  return { columns, champion };
}
