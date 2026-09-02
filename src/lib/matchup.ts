import { slotsOf } from "@/data/league-sim";
import { proj, player, type LeagueShape } from "./roster";
import { formatStatLine, type StatLine } from "./scoring";
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
  /** What the ingestion wrote, used when there is no structured line to read. */
  statLine: string;
  /** The numbers themselves. Absent on rows written before migration 0032. */
  line?: StatLine;
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
  // The roster is authoritative for anybody it knows. For anybody it does
  // not — a pickup from outside the pool — ESPN's own team sheet answers,
  // which is better than formatting his line by guesswork.
  const position = p?.p ?? score?.line?.position ?? "";

  // Written here rather than at ingestion because this is where the position
  // is known for certain: the roster says a man is a tight end even when he
  // never entered the draft pool and the box score did not say.
  const line = score?.line ? formatStatLine(score.line, position) : "";

  return {
    name,
    position,
    team: p?.t ?? "",
    points: score?.points ?? proj(name),
    projected: proj(name),
    live: score != null,
    statLine: line || score?.statLine || "",
  };
}

export interface RosterSlot {
  player_name: string;
  lineup_slot?: string;
}

/**
 * The lineup a manager actually set, laid into the league's slot order.
 *
 * A manager who has never touched their lineup has every row on the bench;
 * rather than field an empty team, that falls back to the best legal lineup.
 */
export function setLineup(
  roster: RosterSlot[],
  league: LeagueShape | null,
  scores: Map<string, Score>,
): { slot: string; entry: SideEntry | null }[] {
  const names = roster.map((r) => r.player_name);
  const chosen = roster.filter((r) => r.lineup_slot && r.lineup_slot !== "BENCH" && r.lineup_slot !== "IR");

  if (!chosen.length) return bestLineup(names, league, scores);

  const remaining = [...chosen];

  return slotsOf(league ?? undefined).map((slot: string) => {
    const at = remaining.findIndex((r) => r.lineup_slot === slot);
    if (at === -1) return { slot, entry: null };
    const [filled] = remaining.splice(at, 1);
    return { slot, entry: entryFor(filled.player_name, scores) };
  });
}

/**
 * Pairs the two lineups slot by slot, so each row is one head-to-head
 * comparison rather than two separate lists read side by side.
 */
export function pairLineups(
  home: RosterSlot[],
  away: RosterSlot[],
  league: LeagueShape | null,
  scores: Map<string, Score>,
): MatchupRow[] {
  const homeLineup = setLineup(home, league, scores);
  const awayLineup = setLineup(away, league, scores);

  return homeLineup.map((row, i) => ({
    slot: row.slot,
    home: row.entry,
    away: awayLineup[i]?.entry ?? null,
  }));
}

export function totalOf(rows: MatchupRow[], side: "home" | "away"): number {
  return Math.round(rows.reduce((sum, r) => sum + (r[side]?.points ?? 0), 0) * 10) / 10;
}
