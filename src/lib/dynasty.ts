import { AGES, POOL, type Player } from "@/data/league-data";

/**
 * Age modifiers for a dynasty draft.
 *
 * In a redraft league a thirty-year-old back who will score 250 points is
 * worth exactly a twenty-three-year-old who will score 250 points. In a
 * dynasty league he is not, because you keep them: one has five seasons left
 * and the other has two. These modifiers are the league's own answer to that,
 * taken from Dynasty_Draft_Modifiers.xlsx and reproduced here unchanged.
 *
 * A modifier above 1 makes a player more valuable. ADP counts the other way —
 * a lower number is an earlier pick — so value is applied by dividing:
 * multiplying a player's worth by 1.2 moves him a fifth of the way up the
 * board, and 0.8 pushes him a quarter of the way down.
 */

/** Positions the table covers. A defence does not have a birthday. */
export type AgedPosition = "QB" | "RB" | "WR" | "TE" | "K";

/**
 * Each entry opens a band that runs until the next one.
 *
 * The sheet lists most ages one by one and ends with "32+" or "36+", which is
 * the same thing said differently: a band that never closes. Writing them all
 * as bands means the "+" rows need no special case — and it also settles the
 * one age the sheet does not mention. Quarterbacks jump from 31 to 33, so 32
 * sits inside the band 31 opened and keeps 1.0. That is the reading that
 * changes least; if the league meant 32 to be 0.95, add the row.
 */
const BANDS: Record<AgedPosition, { from: number; modifier: number }[]> = {
  QB: [
    { from: 20, modifier: 1.15 },
    { from: 23, modifier: 1.1 },
    { from: 26, modifier: 1.05 },
    { from: 29, modifier: 1.0 },
    { from: 33, modifier: 0.95 },
    { from: 36, modifier: 0.9 },
  ],
  RB: [
    { from: 20, modifier: 1.2 },
    { from: 22, modifier: 1.15 },
    { from: 24, modifier: 1.1 },
    { from: 26, modifier: 1.05 },
    { from: 28, modifier: 1.0 },
    { from: 29, modifier: 0.95 },
    { from: 30, modifier: 0.9 },
    { from: 31, modifier: 0.85 },
    { from: 32, modifier: 0.8 },
  ],
  WR: [
    { from: 20, modifier: 1.2 },
    { from: 22, modifier: 1.15 },
    { from: 24, modifier: 1.1 },
    { from: 26, modifier: 1.05 },
    { from: 28, modifier: 1.0 },
    { from: 30, modifier: 0.95 },
    { from: 31, modifier: 0.9 },
    { from: 32, modifier: 0.85 },
  ],
  TE: [
    { from: 20, modifier: 1.2 },
    { from: 23, modifier: 1.15 },
    { from: 25, modifier: 1.1 },
    { from: 27, modifier: 1.05 },
    { from: 29, modifier: 1.0 },
    { from: 31, modifier: 0.95 },
    { from: 32, modifier: 0.9 },
  ],
  K: [
    { from: 20, modifier: 1.1 },
    { from: 23, modifier: 1.05 },
    { from: 26, modifier: 1.0 },
    { from: 29, modifier: 0.95 },
    { from: 31, modifier: 0.9 },
    { from: 32, modifier: 0.85 },
  ],
};

function isAged(position: string): position is AgedPosition {
  return position in BANDS;
}

/**
 * The modifier for a player of this position and age.
 *
 * 1 — no adjustment at all — for a defence, and for anyone whose age the pool
 * does not carry. Guessing at an unknown age would move a player up or down
 * the board on no evidence, which is worse than leaving him where the
 * consensus put him.
 */
export function modifierFor(position: string, age: number | null | undefined): number {
  if (!isAged(position) || age == null || !Number.isFinite(age)) return 1;

  const bands = BANDS[position];
  let found = bands[0].modifier;
  for (const band of bands) {
    if (age >= band.from) found = band.modifier;
    else break;
  }
  return found;
}

/** A player's age as the pool records it, or null if it does not. */
export function ageOfPlayer(name: string): number | null {
  const entry = AGES[name];
  return entry && Number.isFinite(entry.age) ? entry.age : null;
}

/**
 * Where a player goes on a dynasty board.
 *
 * Returns the consensus ADP unchanged when there is no reason to move him, so
 * a league that never fills in an age simply gets the board it always had.
 */
export function dynastyAdp(position: string, adp: number, age: number | null): number {
  const modifier = modifierFor(position, age);
  if (modifier === 1 || !(adp > 0)) return adp;
  return Math.round((adp / modifier) * 10) / 10;
}

export interface Valued {
  name: string;
  position: string;
  age: number | null;
  adp: number;
  modifier: number;
  /** ADP after the age modifier. Lower is earlier, the same as ADP. */
  dynastyAdp: number;
}

/** Everything a board needs to place one player, in one call. */
export function valueOf(player: Pick<Player, "n" | "p" | "adp">): Valued {
  const age = ageOfPlayer(player.n);
  return {
    name: player.n,
    position: player.p,
    age,
    adp: player.adp,
    modifier: modifierFor(player.p, age),
    dynastyAdp: dynastyAdp(player.p, player.adp, age),
  };
}

/** The pool, ordered as a dynasty league would take it. */
export function dynastyBoard(): Valued[] {
  return POOL.map(valueOf).sort(byDynastyAdp);
}

/** Sort comparator: earliest dynasty pick first, ties broken by consensus. */
export function byDynastyAdp(a: Valued, b: Valued): number {
  return a.dynastyAdp - b.dynastyAdp || a.adp - b.adp || a.name.localeCompare(b.name);
}

/**
 * How a board says where a player sits, in one string.
 *
 * "ADP 20.0 · 24yo ×1.10" — the dynasty number first, because that is the one
 * the board is ordered by, then the age and the modifier that produced it. A
 * player the table did not move says only "ADP 24", because there is nothing
 * to explain.
 */
export function adpLabel(value: {
  adp: number;
  age: number | null;
  modifier: number;
  dynastyAdp: number;
}): string {
  if (value.modifier === 1) {
    return `ADP ${value.adp}${value.age != null ? ` · ${value.age}yo` : ""}`;
  }
  return `ADP ${value.dynastyAdp} · ${value.age}yo ×${value.modifier.toFixed(2)}`;
}
