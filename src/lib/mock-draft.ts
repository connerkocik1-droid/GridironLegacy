import { slotsOf, targetsOf } from "@/data/league-sim";
import type { Player, Position } from "@/data/league-data";
import type { LeagueShape } from "./roster";

/**
 * The opponents in a mock draft.
 *
 * They draft off ADP, because that is what a room does, and then argue with it
 * for three reasons: the starting lineup they still have to fill, the depth
 * they are allowed to carry, and the bye weeks they have already collected.
 * Everything below is expressed in ADP spots — "this team will reach eleven
 * places for a quarterback" — because that is the unit the decision is
 * actually made in, and it makes the AI's behaviour legible rather than a
 * black box of weights.
 */

const FLEX_TAKES: Position[] = ["RB", "WR", "TE"];
const KICKING: Position[] = ["K", "D/ST"];

/** How far a team will reach for a starter it does not have yet. */
const REACH_FOR_STARTER = 10;
/** And for the flex, which any of three positions can fill. */
const REACH_FOR_FLEX = 4;
/** Depth is worth having, but nobody reaches for a backup. */
const REACH_FOR_DEPTH = 2;
/** Each player past what the roster wants makes the next one less appealing. */
const SLIDE_PER_SURPLUS = 25;
/** What a third starter on one bye week costs, then a fourth, and so on. */
const SLIDE_PER_BYE = 8;
/**
 * The reach when a starting place must be filled or the lineup is illegal.
 *
 * Deliberately larger than the whole board: at that point the question is no
 * longer which player is better, it is which hole gets filled.
 */
const MUST_FILL = 1000;

/**
 * Nobody carries three quarterbacks, two kickers or two defences, whatever the
 * generic depth maths says. These override the derived caps.
 */
const HARD_CAP: Partial<Record<Position, number>> = { QB: 2, TE: 2, K: 1, "D/ST": 1 };

/**
 * A repeatable pseudo-random source.
 *
 * The jitter below is what stops twelve mock drafts being the same draft, and
 * seeding it is what lets a test say "this is what should happen" about a
 * process that is deliberately not deterministic.
 */
export function rngFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

export interface PickContext {
  /** What this team has taken so far. */
  roster: Player[];
  /** The round about to be picked, from 1. */
  round: number;
  /** How many rounds the mock runs. */
  rounds: number;
  league: LeagueShape;
}

/** How many of each position the starting lineup demands outright. */
function startingNeed(league: LeagueShape): Record<string, number> {
  const need: Record<string, number> = {};
  for (const slot of slotsOf(league)) need[slot] = (need[slot] ?? 0) + 1;
  return need;
}

function countAt(roster: Player[], position: Position): number {
  return roster.filter((p) => p.p === position).length;
}

/**
 * Whether a team will not take this position at all right now.
 *
 * Two rules, both of them things real drafters do without thinking. Kickers
 * and defences wait until the end — taking one in the eighth is the mark of
 * nobody who has drafted before. And no roster carries more of a position than
 * it can use.
 */
export function blocked(position: Position, ctx: PickContext): boolean {
  const { caps } = targetsOf(ctx.league);
  const cap = Math.min(caps[position] ?? 99, HARD_CAP[position] ?? 99);
  if (countAt(ctx.roster, position) >= cap) return true;

  // The last two rounds are where the kicker and the defence go.
  if (KICKING.includes(position) && ctx.round <= ctx.rounds - 2) return true;

  return false;
}

/**
 * How many ADP spots a team will reach for this position, or slide it.
 *
 * The number grows as the draft runs out of room: a team missing a starting
 * tight end in the fourth round would like one, and the same team in the
 * second to last round must have one.
 */
export function needBonus(position: Position, ctx: PickContext): number {
  const need = startingNeed(ctx.league);
  const { want } = targetsOf(ctx.league);
  const have = countAt(ctx.roster, position);

  const dedicated = need[position] ?? 0;
  const short = Math.max(0, dedicated - have);

  // How many starting places are still empty across the whole roster, against
  // how many picks are left to fill them. Once those meet, everything else on
  // the board stops mattering.
  const picksLeft = Math.max(1, ctx.rounds - ctx.round + 1);
  let openStarters = 0;
  for (const [pos, count] of Object.entries(need)) {
    if (pos === "FLEX") continue;
    openStarters += Math.max(0, count - countAt(ctx.roster, pos as Position));
  }
  const urgency = Math.min(1, openStarters / picksLeft);

  if (short > 0) {
    // Once there are as many empty starting places as picks left, the draft
    // stops being about value: every remaining pick has a job. A team that
    // spends one of them on a fourth receiver cannot field a legal lineup,
    // and no drafter does that knowingly.
    if (openStarters >= picksLeft) return MUST_FILL;
    return REACH_FOR_STARTER * short * (0.4 + 1.6 * urgency);
  }

  // The flex is open to whichever skill position offers the best player — but
  // only while a flex slot is actually still empty. Counting skill players
  // against skill slots in the aggregate gets this wrong: four running backs
  // and nothing else leaves the receiver slots open, and a fifth running back
  // cannot fill one of those. So dedicated slots are filled by their own
  // position first, and only what spills over lands in the flex.
  const flexSlots = need.FLEX ?? 0;
  if (flexSlots > 0 && FLEX_TAKES.includes(position)) {
    const spillover = FLEX_TAKES.reduce(
      (n, p) => n + Math.max(0, countAt(ctx.roster, p) - (need[p] ?? 0)),
      0,
    );
    if (spillover < flexSlots) return REACH_FOR_FLEX;
  }

  const wanted = want[position] ?? 0;
  if (have < wanted) return REACH_FOR_DEPTH;

  // Past what the roster wants: each one already held makes the next slide
  // further down the board.
  return -SLIDE_PER_SURPLUS * (have - wanted + 1);
}

/**
 * What a bye week clash costs a player, in ADP spots.
 *
 * Two starters sharing a bye is a normal week off. Three is a hole in the
 * lineup, and the fourth is worse than the third, so the penalty compounds.
 * Kickers and defences are exempt: those get streamed round the bye anyway.
 */
export function byePenalty(candidate: Player, ctx: PickContext): number {
  if (!candidate.bye || KICKING.includes(candidate.p)) return 0;

  const sharing = ctx.roster.filter(
    (p) => p.bye === candidate.bye && !KICKING.includes(p.p),
  ).length;

  if (sharing < 2) return 0;
  return SLIDE_PER_BYE * (sharing - 1);
}

/**
 * Where this player really sits for this team, as an ADP the team would act on.
 *
 * Lower is better, exactly like ADP itself, so the whole decision stays in one
 * readable unit: a receiver at ADP 40 that a team needs badly and whose bye is
 * clear might come out at 27, and the room would call that a reach of thirteen.
 */
export function effectiveAdp(
  candidate: Player,
  ctx: PickContext,
  jitter = 0,
): number {
  return (
    candidate.adp - needBonus(candidate.p, ctx) + byePenalty(candidate, ctx) + jitter
  );
}

/** How far opinions spread in a given round: consensus early, chaos late. */
function spread(round: number): number {
  return 3 + round * 1.2;
}

/**
 * The pick.
 *
 * Only the top of the board is considered. No team reaches sixty places for a
 * need, and looking at every remaining player would let the jitter eventually
 * throw up somebody absurd.
 */
export function chooseFor(
  available: Player[],
  ctx: PickContext,
  rng: () => number,
  window = 40,
): Player | null {
  const ranked = [...available].sort((a, b) => a.adp - b.adp);
  const board = ranked.slice(0, window);

  // Plus the best left at every position the lineup still demands, wherever
  // they sit on the board. Defences go around ADP 240 and a top-forty window
  // in the fourteenth round reaches nowhere near them — a team would finish
  // the draft without one, not because it decided against it but because it
  // never saw one. This is the drafter asking "who is the best defence left?"
  // rather than reading down the list.
  const need = startingNeed(ctx.league);
  for (const position of Object.keys(need)) {
    if (position === "FLEX") continue;
    const pos = position as Position;
    if (countAt(ctx.roster, pos) >= (need[pos] ?? 0)) continue;
    const bestLeft = ranked.find((p) => p.p === pos);
    if (bestLeft && !board.includes(bestLeft)) board.push(bestLeft);
  }

  if (!board.length) return null;

  let best: Player | null = null;
  let bestScore = Infinity;

  for (const candidate of board) {
    if (blocked(candidate.p, ctx)) continue;
    const score = effectiveAdp(candidate, ctx, (rng() - 0.5) * spread(ctx.round));
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  // Every one of them blocked — a roster full at every position it is allowed
  // to fill. Take the best available rather than stalling the draft.
  return best ?? ranked[0] ?? null;
}

/**
 * The order of picks in a snake draft, as team indexes.
 *
 * Odd rounds run forward, even rounds back, which is the whole of the snake.
 */
export function snakeOrder(teams: number, rounds: number): number[] {
  const order: number[] = [];
  for (let round = 1; round <= rounds; round++) {
    for (let seat = 0; seat < teams; seat++) {
      order.push(round % 2 === 1 ? seat : teams - seat - 1);
    }
  }
  return order;
}
