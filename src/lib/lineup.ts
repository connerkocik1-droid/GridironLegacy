import { slotsOf } from "@/data/league-sim";
import type { LeagueShape } from "./roster";
import type { Position } from "@/data/league-data";

/**
 * What a lineup is made of, in a league where nobody arranges one.
 *
 * This file used to hold the rules for saving a lineup — what a slot accepts,
 * whether a whole arrangement was legal, what was wrong with a legal one. Best
 * ball took the arranging away, and with it every rule about who may do it.
 * What is left is the shape of the thing: which slots this league fields, and
 * what each will take. That shape is still needed everywhere — by the code
 * that fills the slots automatically, by the matchup page, by the mock draft —
 * it is just no longer anybody's decision.
 */

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
