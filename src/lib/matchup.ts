import { slotsOf } from "@/data/league-sim";
import { proj, player, type LeagueShape } from "./roster";
import type { Position } from "@/data/league-data";

const FLEX_TAKES: Position[] = ["RB", "WR", "TE"];

export interface SideEntry {
  name: string;
  position: string;
  team: string;
  /** Live points once the game has been played, else the projection. */
  points: number;
  projected: number;
  live: boolean;
  statLine: string;
}

export interface MatchupRow {
  slot: string;
  home: SideEntry | null;
  away: SideEntry | null;
}

export interface Score {
  points: number;
  statLine: string;
}

/**
 * The best legal lineup for a roster, in the league's own slot order. Ported
 * from league-sim's startersOf: highest projection first, each slot taking the
 * best player it will accept that is not already placed.
 */
export function bestLineup(
  roster: string[],
  league: LeagueShape | null,
  scores: Map<string, Score>,
): { slot: string; entry: SideEntry | null }[] {
  const ranked = [...roster].sort((a, b) => pointsFor(b, scores) - pointsFor(a, scores));
  const used = new Set<string>();

  return slotsOf(league ?? undefined).map((slot: string) => {
    const accepts = slot === "FLEX" ? FLEX_TAKES : [slot];

    const pick = ranked.find((name) => {
      if (used.has(name)) return false;
      const p = player(name);
      return p ? accepts.includes(p.p) : false;
    });

    if (!pick) return { slot, entry: null };
    used.add(pick);
    return { slot, entry: entryFor(pick, scores) };
  });
}

function pointsFor(name: string, scores: Map<string, Score>): number {
  return scores.get(name)?.points ?? proj(name);
}

function entryFor(name: string, scores: Map<string, Score>): SideEntry {
  const p = player(name);
  const score = scores.get(name);
  return {
    name,
    position: p?.p ?? "",
    team: p?.t ?? "",
    points: score?.points ?? proj(name),
    projected: proj(name),
    live: score != null,
    statLine: score?.statLine ?? "",
  };
}

/**
 * Pairs the two lineups slot by slot, so each row is one head-to-head
 * comparison rather than two separate lists read side by side.
 */
export function pairLineups(
  home: string[],
  away: string[],
  league: LeagueShape | null,
  scores: Map<string, Score>,
): MatchupRow[] {
  const homeLineup = bestLineup(home, league, scores);
  const awayLineup = bestLineup(away, league, scores);

  return homeLineup.map((row, i) => ({
    slot: row.slot,
    home: row.entry,
    away: awayLineup[i]?.entry ?? null,
  }));
}

export function totalOf(rows: MatchupRow[], side: "home" | "away"): number {
  return Math.round(rows.reduce((sum, r) => sum + (r[side]?.points ?? 0), 0) * 10) / 10;
}
