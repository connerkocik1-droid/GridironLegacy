import { player } from "@/lib/roster";

/**
 * What a manager still has no way to field.
 *
 * Not "what would round out the roster" — that is a matter of taste, and a
 * screen that offers taste during a ninety-second clock is offering noise.
 * This is the hard version of the question: if the draft ended now, which
 * starting slots would go out empty and score nothing?
 *
 * That distinction matters because the two answers disagree. A depth target
 * for an eighteen-man roster wants seven running backs and nine receivers —
 * twenty-four players for eighteen places, so it is never satisfied and would
 * mark every position as short from the first pick to the last. The starting
 * requirement is satisfiable, reaches nought, and is the thing that actually
 * costs points: a manager who finishes with no kicker scores nothing at
 * kicker, every week, all season.
 *
 * FLEX is deliberately left out. It takes a back, a receiver or a tight end,
 * so it is never the reason somebody is short of a particular position — and
 * counting it would tell a manager they need a running back when what they
 * are short of is any skill player at all.
 */

/** The default shape, matching src/data/league-settings.js. */
const FALLBACK: Record<string, number> = {
  QB: 1,
  RB: 2,
  WR: 2,
  TE: 1,
  "D/ST": 1,
  K: 1,
};

export interface Need {
  position: string;
  /** How many more are needed before this slot can be filled. */
  short: number;
}

/**
 * @param drafted the names this manager already holds
 * @param starters the league's starting requirement, FLEX included and ignored
 */
export function stillNeeded(
  drafted: string[],
  starters?: Record<string, number> | null,
): Need[] {
  const want = { ...FALLBACK, ...(starters ?? {}) };

  const held: Record<string, number> = {};
  for (const name of drafted) {
    // A player the pool has never heard of has no position, and guessing one
    // would put a phantom body in a slot the manager cannot actually fill.
    const pos = player(name)?.p;
    if (pos) held[pos] = (held[pos] ?? 0) + 1;
  }

  const needs: Need[] = [];
  for (const [position, count] of Object.entries(want)) {
    if (position === "FLEX" || !count) continue;
    const short = count - (held[position] ?? 0);
    if (short > 0) needs.push({ position, short });
  }

  // Scarcest first: a manager with one slot left to fill wants to be told
  // about the kicker they have none of before the second receiver.
  return needs.sort((a, b) => b.short - a.short || a.position.localeCompare(b.position));
}
