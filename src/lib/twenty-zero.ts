import type { Season } from "@/data/twenty-zero-data";

/**
 * 20-0 mode: twelve rounds, twelve slots, one perfect season.
 *
 * Each round spins a franchise and an era, and offers that franchise's best
 * seasons inside it. You take one. Do that twelve times and the roster scores;
 * a perfect run is 20-0.
 *
 * The rules live here rather than in the component because they are the game —
 * which slots a position can fill, what a spin may land on, when a round has
 * nothing left to offer — and all of it is worth being able to test without a
 * browser.
 */

export const OFFENSE = ["QB", "RB", "WR", "TE", "FLEX", "FLEX"] as const;
export const DEFENSE = ["EDGE", "DT/EDGE", "LB", "CB", "CB/S", "FLEX"] as const;
export const SLOTS: string[] = [...OFFENSE, ...DEFENSE];

/** The positions that carry a multiplier, and what it is. */
export const MULT: Record<string, number> = { QB: 1.5, EDGE: 1.5, CB: 1.5 };

/**
 * Which pools each slot will take.
 *
 * Two grouped pools stand in for four positions: the defensive-line and
 * secondary exports carry no position column, so EDGE and DT/EDGE both draw
 * DL, and CB and CB/S both draw DB.
 */
const SLOT_POOLS: Record<string, string[]> = {
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  EDGE: ["DL"],
  "DT/EDGE": ["DL"],
  LB: ["LB"],
  CB: ["DB"],
  "CB/S": ["DB"],
};

/** FLEX takes any position on its own side except quarterback. */
const FLEX_POOLS: Record<"offense" | "defense", string[]> = {
  offense: ["RB", "WR", "TE"],
  defense: ["DL", "LB", "DB"],
};

export function poolsForSlot(slot: string, defense: boolean): string[] {
  if (slot === "FLEX") return FLEX_POOLS[defense ? "defense" : "offense"];
  return SLOT_POOLS[slot] ?? [slot];
}

/** Rounds 1-6 are offence, 7-12 defence. */
export function isDefence(round: number): boolean {
  return round >= OFFENSE.length;
}

export function sideFor(round: number): readonly string[] {
  return isDefence(round) ? DEFENSE : OFFENSE;
}

export type Roster = (Season | null)[];

/** Every season a round can offer, which is every position on that side. */
export function poolFor(round: number, pools: Record<string, Season[]>): Season[] {
  const defence = isDefence(round);
  const keys: string[] = [];
  for (const slot of sideFor(round)) {
    for (const key of poolsForSlot(slot, defence)) if (!keys.includes(key)) keys.push(key);
  }
  return keys.flatMap((k) => pools[k] ?? []);
}

/**
 * Where a player can go: a named slot that takes his position, otherwise FLEX
 * on the same side. Returns -1 when the side has no room for him.
 *
 * Named slots are tried first, so a player only reaches the flex once his own
 * position is spoken for.
 */
export function slotIndexFor(pos: string, round: number, roster: Roster): number {
  const side = sideFor(round);
  const defence = isDefence(round);
  const base = defence ? OFFENSE.length : 0;
  const takes = (slot: string) => poolsForSlot(slot, defence).includes(pos);

  for (let k = 0; k < side.length; k++) {
    if (side[k] !== "FLEX" && takes(side[k]) && !roster[base + k]) return base + k;
  }
  for (let k = 0; k < side.length; k++) {
    if (side[k] === "FLEX" && takes("FLEX") && !roster[base + k]) return base + k;
  }
  return -1;
}

/**
 * Whether a round can be played at all.
 *
 * A side's pool can be large and still have nothing draftable: once EDGE,
 * DT/EDGE and the defensive flex are filled, every defensive lineman left has
 * no slot to sit in. So readiness asks whether anything can actually be
 * placed, not whether anything remains.
 */
export function playable(round: number, roster: Roster, pools: Record<string, Season[]>): boolean {
  if (round >= SLOTS.length) return false;
  return poolFor(round, pools).some((p) => slotIndexFor(p.pos, round, roster) > -1);
}

export interface Candidate {
  season: Season;
  /** False for the era wildcards that fill out a thin franchise. */
  own: boolean;
}

/** How many rows a round's board offers. */
export const BOARD_SIZE = 6;

/**
 * The board for a franchise and era.
 *
 * A round is open to every position on its side, so the board runs deeper than
 * one position's shortlist. Where the franchise has fewer than six qualifying
 * seasons, the rest is filled from the same era across the league — marked as
 * wildcards — so a round is always a real choice rather than a forced pick.
 */
export function candidatesFor(
  pools: Record<string, Season[]>,
  team: string,
  era: number,
  round: number,
  roster: Roster,
  rng: () => number,
): Candidate[] {
  const all = poolFor(round, pools);
  const taken = new Set(roster.filter(Boolean).map((p) => (p as Season).n));

  // A player counts as available only if some slot on this side can hold him.
  const free = (p: Season) => !taken.has(p.n) && slotIndexFor(p.pos, round, roster) > -1;

  const own = all
    .filter((p) => p.t === team && p.era === era && free(p))
    .sort((a, b) => b.sc - a.sc);

  if (own.length >= BOARD_SIZE) {
    return own.slice(0, BOARD_SIZE).map((season) => ({ season, own: true }));
  }

  const rest = all.filter((p) => p.era === era && p.t !== team && free(p)).sort((a, b) => b.sc - a.sc);
  const fill: Season[] = [];
  while (fill.length < BOARD_SIZE - own.length && rest.length) {
    // From the top twelve rather than the very top, so the wildcards are not
    // the same six names in every run.
    fill.push(rest.splice(Math.floor(rng() * Math.min(12, rest.length)), 1)[0]);
  }

  return [
    ...own.map((season) => ({ season, own: true })),
    ...fill.map((season) => ({ season, own: false })),
  ];
}

export interface Spin {
  team: string;
  era: number;
  candidates: Candidate[];
}

/**
 * Resolves what a spin lands on.
 *
 * The draw is settled before anything animates, so the reel comes to rest on
 * the real franchise and era rather than on a value the board then
 * contradicts. Draws that would offer nothing are retried; one that offers a
 * single row is accepted rather than spun forever, and a dead end returns null
 * so the round can be skipped.
 */
export function drawSpin(
  pools: Record<string, Season[]>,
  round: number,
  roster: Roster,
  rng: () => number,
  attempts = 40,
): Spin | null {
  const all = poolFor(round, pools);
  if (!all.length) return null;

  let last: Spin | null = null;

  for (let i = 0; i < attempts; i++) {
    const seed = all[Math.floor(rng() * all.length)];
    const candidates = candidatesFor(pools, seed.t, seed.era, round, roster, rng);
    if (!candidates.length) continue;

    last = { team: seed.t, era: seed.era, candidates };
    if (candidates.length >= 2) return last;
  }

  return last;
}

/** Every franchise and era the round's pool contains, for the reel to tumble through. */
export function reelValues(round: number, pools: Record<string, Season[]>) {
  const all = poolFor(round, pools);
  return {
    teams: [...new Set(all.map((p) => p.t))],
    eras: [...new Set(all.map((p) => p.era))].sort((a, b) => a - b),
  };
}

/** The run's score: every season, multiplied where its slot carries one. */
export function total(roster: Roster): number {
  return roster.reduce<number>(
    (sum, p, i) => (p ? sum + p.sc * (MULT[SLOTS[i]] ?? 1) : sum),
    0,
  );
}

/** A repeatable pseudo-random source, so a run can be replayed in a test. */
export function rngFrom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}
