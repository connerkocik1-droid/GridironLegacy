import { POOL, find, type Player } from "@/data/league-data";
import { chooseFor } from "./mock-draft";
import type { LeagueShape } from "./roster";

/**
 * What to draft for a manager who is not drafting.
 *
 * Two answers, in that order, and the order is the whole design. A manager who
 * queued somebody wants that person: the queue is a decision already made, and
 * overriding it with a better player would be the app telling a manager it
 * knows their team better than they do. The queue is read in the database,
 * inside the same transaction that makes the pick, because it has to be
 * checked against who is still available at the instant of picking.
 *
 * This is the second answer — what to take when the queue is empty or everyone
 * on it is gone. Not "best available by ADP", which drafts a fourth
 * quarterback in the ninth round and finishes the night without a kicker, but
 * the same reasoning the mock draft's opponents use: ADP, argued with by the
 * starting lineup still to fill, the depth the roster is allowed to carry, and
 * the bye weeks already collected.
 *
 * Deliberately not random. The mock's opponents jitter their boards so twelve
 * mock drafts are not the same draft; a manager whose clock ran out is owed
 * the pick the reasoning actually points at, so the jitter is pinned to zero.
 */

/** No jitter: the same board, the same roster, the same pick, every time. */
const NO_JITTER = () => 0.5;

export interface AutodraftContext {
  /** Everybody already on a roster in this league. */
  taken: Set<string>;
  /** What this manager has drafted so far, by name. */
  roster: string[];
  /** The round of the pick being made, from 1. */
  round: number;
  /** How many rounds the draft runs. */
  rounds: number;
  /** The league's starters, bench and flex, which is what "need" is measured against. */
  league: LeagueShape;
}

/**
 * The name to draft, or null if there is nobody left in the pool to draft.
 *
 * Null is a real answer rather than a failure: a draft deep enough to exhaust
 * five hundred and eighty-five players has run out of board, and the caller
 * passes the null on so the database says "nothing to pick" instead of
 * inventing somebody.
 */
export function autodraftPick(ctx: AutodraftContext): string | null {
  const available = POOL.filter((p) => !ctx.taken.has(p.n));
  if (!available.length) return null;

  const roster = ctx.roster
    .map((name) => find(name))
    .filter((p): p is Player => Boolean(p));

  const chosen = chooseFor(
    available,
    {
      roster,
      round: Math.max(1, ctx.round),
      rounds: Math.max(ctx.round, ctx.rounds),
      league: ctx.league,
    },
    NO_JITTER,
  );

  return chosen?.n ?? null;
}
