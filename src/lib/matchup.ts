import { slotsOf } from "@/data/league-sim";
import { proj, player, type LeagueShape } from "./roster";
import { formatStatLine, type StatLine } from "./scoring";
import type { Position } from "@/data/league-data";

const FLEX_TAKES: Position[] = ["RB", "WR", "TE"];

export interface SideEntry {
  name: string;
  position: string;
  team: string;
  /**
   * What this player is worth to the week right now. Before kickoff that is
   * his projection; once the week is live it is what he has actually scored,
   * and a man who has not played yet is worth nought — because that is what
   * the lineup is being arranged and graded on.
   */
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
 * The lineup a roster is fielding — which in this league is not a choice.
 *
 * Best ball: every dedicated slot takes the highest scorer at its position and
 * the flex takes the best of what is left, so there is exactly one right
 * answer and it moves as the scores do. Greedy is provably correct for this
 * shape, because only the flex is shared between positions — a slot that also
 * took quarterbacks would break the reasoning, which is one more reason this
 * league does not field one.
 *
 * The basis is the argument. Before a ball is kicked every real score is
 * nought, so ordering by them would be ordering by nothing — the preview goes
 * by projection, and says so. Once the week is live the only thing that counts
 * is what has actually been scored, unplayed included at nought, because that
 * is the arrangement being graded and a page showing a different one is
 * lying about the rule.
 *
 * Ties break on name, which is the same tie-break best_ball_lineup uses in
 * migration 0036. Two players level is common on a Sunday morning when
 * everybody is on nought, and a slot that reshuffles itself between two
 * refreshes for no reason looks broken.
 */
export function bestLineup(
  roster: string[],
  league: LeagueShape | null,
  scores: Map<string, Score>,
  basis: "points" | "projection" = "projection",
): { slot: string; entry: SideEntry | null }[] {
  const value = (name: string) =>
    basis === "points" ? (scores.get(name)?.points ?? 0) : pointsFor(name, scores);

  const ranked = [...roster].sort((a, b) => value(b) - value(a) || a.localeCompare(b));
  const used = new Set<string>();

  return slotsOf(league ?? undefined).map((slot: string) => {
    const accepts = slot === "FLEX" ? FLEX_TAKES : [slot];

    const pick = ranked.find((name) => {
      if (used.has(name)) return false;
      const p = positionOf(name, scores);
      return p ? accepts.includes(p as Position) : false;
    });

    if (!pick) return { slot, entry: null };
    used.add(pick);
    return { slot, entry: entryFor(pick, scores, basis) };
  });
}

/**
 * What somebody plays. The pool for anybody who was ever draftable, and for a
 * pickup from outside it the position ESPN's own team sheet put on his stat
 * line — never inferred from what he did on the field.
 */
function positionOf(name: string, scores: Map<string, Score>): string {
  return player(name)?.p ?? scores.get(name)?.line?.position ?? "";
}

function pointsFor(name: string, scores: Map<string, Score>): number {
  return scores.get(name)?.points ?? proj(name);
}

function entryFor(
  name: string,
  scores: Map<string, Score>,
  basis: "points" | "projection",
): SideEntry {
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
    // Nought rather than a projection once the week is live: a total that
    // quietly includes points nobody has scored is a total that goes down as
    // the afternoon goes on, which is the one thing a live score must never do.
    points: score?.points ?? (basis === "points" ? 0 : proj(name)),
    projected: proj(name),
    live: score != null,
    statLine: line || score?.statLine || "",
  };
}

export interface RosterSlot {
  player_name: string;
}

/** One row of the lineup a graded week wrote down. */
export interface FrozenStarter {
  name: string;
  slot: string;
  points: number;
}

/**
 * The lineup a settled week was settled on, read back rather than recomputed.
 *
 * A graded week is history. Working it out again from today's rosters would
 * quietly rewrite it every time somebody made a trade — the man who won you
 * week three would leave with him. grade_week photographs the arrangement when
 * the last game ends, and this is that photograph, laid back into the league's
 * slot order so it reads like every other week.
 */
export function frozenLineup(
  starters: unknown,
  league: LeagueShape | null,
  scores: Map<string, Score>,
): { slot: string; entry: SideEntry | null }[] {
  const rows: FrozenStarter[] = Array.isArray(starters)
    ? (starters as Record<string, unknown>[]).flatMap((r) =>
        typeof r?.name === "string" && typeof r?.slot === "string"
          ? [{ name: r.name, slot: r.slot, points: Number(r.points ?? 0) }]
          : [],
      )
    : [];

  const remaining = [...rows];
  // The points come from the snapshot, not from player_scores: a late stat
  // correction must not change a result that has already been recorded.
  const entry = (row: FrozenStarter) => ({
    ...entryFor(row.name, scores, "points"),
    points: row.points,
    live: true,
  });

  const laid = slotsOf(league ?? undefined).map((slot: string) => {
    const at = remaining.findIndex((r) => r.slot === slot);
    if (at === -1) return { slot, entry: null as SideEntry | null };
    const [row] = remaining.splice(at, 1);
    return { slot, entry: entry(row) };
  });

  // A slot the league has since stopped fielding still has to show: the sum of
  // these rows is the score the week was decided by, and a row silently
  // dropped is a total that no longer adds up.
  return [...laid, ...remaining.map((row) => ({ slot: row.slot, entry: entry(row) }))];
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
  basis: "points" | "projection" = "projection",
  frozen?: { home: unknown; away: unknown } | null,
): MatchupRow[] {
  const names = (side: RosterSlot[]) => side.map((r) => r.player_name);
  const side = (roster: RosterSlot[], snapshot: unknown) =>
    snapshot != null && Array.isArray(snapshot) && snapshot.length
      ? frozenLineup(snapshot, league, scores)
      : bestLineup(names(roster), league, scores, basis);

  const homeLineup = side(home, frozen?.home);
  const awayLineup = side(away, frozen?.away);

  // Both sides field the same slots in the same order, so this is normally
  // just a zip. It is written to the longer of the two because a settled week
  // reads its rows back from a snapshot, and a league whose starting lineup
  // changed since could leave one side a row longer.
  const rowCount = Math.max(homeLineup.length, awayLineup.length);

  return Array.from({ length: rowCount }, (_, i) => ({
    slot: homeLineup[i]?.slot ?? awayLineup[i]?.slot ?? "",
    home: homeLineup[i]?.entry ?? null,
    away: awayLineup[i]?.entry ?? null,
  }));
}

export function totalOf(rows: MatchupRow[], side: "home" | "away"): number {
  return Math.round(rows.reduce((sum, r) => sum + (r[side]?.points ?? 0), 0) * 10) / 10;
}

/**
 * How much more a player out of the slots would have to score to take one.
 *
 * In best ball nobody sets a lineup, which takes away the decision and — until
 * now — took the drama with it: the rest of the roster was a list of names in
 * score order, and nothing said which of them was a touchdown from the team.
 * That is the whole interest of the format on a Sunday afternoon, and it was
 * the one thing the page did not say.
 *
 * The gap is exact rather than an approximation. A player can only enter the
 * lineup by displacing somebody in a slot he is eligible for, and the flex is
 * one of those slots — so the smallest such difference is also the smallest
 * improvement that would rearrange anything, cascades through the flex
 * included. Nought means he is already worth a slot, which the greedy
 * assignment makes impossible; it is returned rather than asserted against.
 *
 * A player with no slot to take at all — the fourth quarterback in a
 * one-quarterback league — is absent from the map rather than carrying a
 * number that could never fall.
 */
export function bubbleGaps(
  rows: { slot: string; entry: SideEntry | null }[],
  bench: string[],
  scores: Map<string, Score>,
  basis: "points" | "projection" = "projection",
): Map<string, number> {
  const value = (name: string) =>
    basis === "points" ? (scores.get(name)?.points ?? 0) : pointsFor(name, scores);

  const gaps = new Map<string, number>();

  for (const name of bench) {
    const p = positionOf(name, scores);
    if (!p) continue;

    let best: number | null = null;
    for (const row of rows) {
      const accepts = row.slot === "FLEX" ? FLEX_TAKES : [row.slot];
      if (!accepts.includes(p as Position)) continue;
      // An empty slot is not a gap of its own size, it is no gap at all.
      const gap = Math.max(0, (row.entry?.points ?? 0) - value(name));
      if (best == null || gap < best) best = gap;
    }

    if (best != null) gaps.set(name, Math.round(best * 10) / 10);
  }

  return gaps;
}
