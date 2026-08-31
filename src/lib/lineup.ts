import { slotsOf } from "@/data/league-sim";
import { player, type LeagueShape } from "./roster";
import type { Position } from "@/data/league-data";

export const BENCH = "BENCH";
export const IR = "IR";

const FLEX_TAKES: Position[] = ["RB", "WR", "TE"];

/** What a slot will accept. FLEX takes the skill positions the league starts. */
export function slotAccepts(slot: string, position: Position, league?: LeagueShape | null): boolean {
  if (slot === BENCH || slot === IR) return true;

  if (slot === "FLEX") {
    const starters = league?.starters;
    const takes = starters ? FLEX_TAKES.filter((p) => (starters[p] ?? 0) > 0) : FLEX_TAKES;
    return (takes.length ? takes : FLEX_TAKES).includes(position);
  }

  return slot === position;
}

/** Every starting slot the league fields, with duplicates: QB, RB, RB, WR… */
export function startingSlots(league?: LeagueShape | null): string[] {
  return slotsOf(league ?? undefined);
}

export interface Assignment {
  playerName: string;
  slot: string;
}

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * Checks a whole proposed lineup at once, rather than one move at a time: a
 * swap is only legal in the context of everything else on the roster, and
 * validating moves individually would let a manager reach an illegal lineup
 * one legal-looking step at a time.
 */
export function validateLineup(
  assignments: Assignment[],
  roster: string[],
  league: LeagueShape | null,
  limits?: { bench?: number; ir?: number },
): ValidationResult {
  const owned = new Set(roster);
  const seen = new Set<string>();

  for (const a of assignments) {
    if (!owned.has(a.playerName)) {
      return { ok: false, error: `${a.playerName} is not on your roster` };
    }
    if (seen.has(a.playerName)) {
      return { ok: false, error: `${a.playerName} appears twice` };
    }
    seen.add(a.playerName);
  }

  if (seen.size !== roster.length) {
    return { ok: false, error: "Every player on the roster needs a slot" };
  }

  // Each starting slot has a fixed number of seats.
  const seats = new Map<string, number>();
  for (const slot of startingSlots(league)) {
    seats.set(slot, (seats.get(slot) ?? 0) + 1);
  }

  const used = new Map<string, number>();

  for (const a of assignments) {
    if (a.slot === BENCH || a.slot === IR) {
      used.set(a.slot, (used.get(a.slot) ?? 0) + 1);
      continue;
    }

    const seat = seats.get(a.slot);
    if (seat == null) {
      return { ok: false, error: `This league does not field a ${a.slot}` };
    }

    const count = (used.get(a.slot) ?? 0) + 1;
    if (count > seat) {
      return { ok: false, error: `Only ${seat} ${a.slot} can start` };
    }
    used.set(a.slot, count);

    const p = player(a.playerName);
    if (!p) return { ok: false, error: `${a.playerName} is not a known player` };
    if (!slotAccepts(a.slot, p.p, league)) {
      return { ok: false, error: `${a.playerName} cannot play ${a.slot}` };
    }
  }

  const benchLimit = limits?.bench ?? league?.bench;
  if (benchLimit != null && (used.get(BENCH) ?? 0) > benchLimit) {
    return { ok: false, error: `The bench holds ${benchLimit}` };
  }

  const irLimit = limits?.ir ?? league?.ir;
  if (irLimit != null && (used.get(IR) ?? 0) > irLimit) {
    return { ok: false, error: `Injured reserve holds ${irLimit}` };
  }

  return { ok: true };
}

/**
 * Lays a roster out into the league's slots, best projection first. Used as
 * the opening lineup for a manager who has never set one, so a team is never
 * fielded empty.
 */
export function defaultLineup(
  roster: string[],
  league: LeagueShape | null,
  rank: (name: string) => number,
): Assignment[] {
  const ranked = [...roster].sort((a, b) => rank(b) - rank(a));
  const placed = new Set<string>();
  const out: Assignment[] = [];

  for (const slot of startingSlots(league)) {
    const pick = ranked.find((name) => {
      if (placed.has(name)) return false;
      const p = player(name);
      return p ? slotAccepts(slot, p.p, league) : false;
    });
    if (pick) {
      placed.add(pick);
      out.push({ playerName: pick, slot });
    }
  }

  for (const name of roster) {
    if (!placed.has(name)) out.push({ playerName: name, slot: BENCH });
  }

  return out;
}

export type ProblemKind = "empty" | "bye" | "injured";

export interface Problem {
  kind: ProblemKind;
  slot: string;
  /** Absent for an empty slot: there is nobody to name. */
  player?: string;
  message: string;
}

/**
 * What is wrong with a lineup that is nonetheless legal.
 *
 * validateLineup answers "may this be saved". This answers the different and
 * more useful question: is this the lineup you meant. Starting nobody at
 * tight end, or a player on his bye, is perfectly legal and scores zero, and
 * the site has never said a word about either.
 *
 * Ordered worst first — an empty slot costs everything, a bye costs
 * everything but is at least visible on the card, and a questionable player
 * may well play.
 */
export function lineupProblems(
  assignments: Assignment[],
  league: LeagueShape | null,
  week: number,
  lookup: (name: string) => { p: string; bye: number; q: boolean } | null,
): Problem[] {
  const problems: Problem[] = [];

  // Seats are counted rather than matched by name: two of three flex spots
  // filled is one empty flex, and saying "FLEX is empty" once would be wrong.
  const seats = new Map<string, number>();
  for (const slot of startingSlots(league)) seats.set(slot, (seats.get(slot) ?? 0) + 1);

  const filled = new Map<string, number>();
  for (const a of assignments) {
    if (a.slot === BENCH || a.slot === IR) continue;
    filled.set(a.slot, (filled.get(a.slot) ?? 0) + 1);
  }

  for (const [slot, seat] of seats) {
    const empty = seat - (filled.get(slot) ?? 0);
    for (let i = 0; i < empty; i++) {
      problems.push({
        kind: "empty",
        slot,
        message: `Nobody is starting at ${slot === "D/ST" ? "DST" : slot}.`,
      });
    }
  }

  for (const a of assignments) {
    if (a.slot === BENCH || a.slot === IR) continue;
    const p = lookup(a.playerName);
    if (!p) continue;

    // A bye is known from the schedule, so this is certain rather than a
    // guess: he will score nothing.
    if (p.bye && p.bye === week) {
      problems.push({
        kind: "bye",
        slot: a.slot,
        player: a.playerName,
        message: `${a.playerName} is on his bye this week.`,
      });
    } else if (p.q) {
      problems.push({
        kind: "injured",
        slot: a.slot,
        player: a.playerName,
        message: `${a.playerName} is questionable.`,
      });
    }
  }

  const rank: Record<ProblemKind, number> = { empty: 0, bye: 1, injured: 2 };
  return problems.sort((a, b) => rank[a.kind] - rank[b.kind]);
}
