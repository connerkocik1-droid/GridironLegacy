/**
 * When the sixteen-bit skin plays its touchdown fanfare. Pure, so it can be
 * tested without a page.
 *
 * The rule from the handoff: only for the reader's own players, and only on a
 * real scoring jump — three or more points between two live readings of the
 * same player. A first reading is not a jump (opening the page mid-game must
 * not fanfare everybody who has already scored), and nor is a drop: a stat
 * correction taking points away is not a touchdown.
 */

/** The smallest gain that counts as a scoring play rather than a few yards. */
export const FANFARE_MIN = 3;

export interface Reading {
  name: string;
  points: number;
  live: boolean;
}

export interface Jump {
  name: string;
  gain: number;
}

/**
 * The biggest qualifying jump between two readings of the same lineup, or
 * null. One banner at a time, so one answer: the biggest play wins.
 */
export function biggestJump(before: Reading[] | null, after: Reading[]): Jump | null {
  if (!before) return null;
  const was = new Map(before.map((r) => [r.name, r.points]));
  let best: Jump | null = null;
  for (const r of after) {
    if (!r.live) continue;
    const prior = was.get(r.name);
    if (prior === undefined) continue;
    const gain = r.points - prior;
    if (gain >= FANFARE_MIN && (!best || gain > best.gain)) best = { name: r.name, gain };
  }
  return best;
}

/** What the banner says under TOUCHDOWN!: "Bijan Robinson +6.1". */
export function fanfareText(jump: Jump): string {
  return `${jump.name} +${jump.gain.toFixed(1)}`;
}
