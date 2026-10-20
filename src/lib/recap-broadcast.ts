/**
 * Week Recap v2, the "broadcast cut": the figures and sentences its four beats
 * show, on top of the ones recap.ts already works out.
 *
 * Pure, like recap.ts, so every branch is tested without a browser. Nothing
 * here is authored: the verdict, the margin note, the high score's read, the
 * MVP's note, the seed move and the playoff math all fall out of the graded
 * fixtures and the frozen best-ball lineup.
 *
 * Seeding follows the league's own `seeding()` in the database — division
 * winners first, then win percentage, then points for, then the franchise slot
 * — rather than the design's head-to-head tiebreak, so the recap can never
 * name a seed the standings and the bracket disagree with.
 */
import {
  ordinal,
  opponentIn,
  pointsFor,
  resultsThrough,
  scoreIn,
  weeksIn,
  type RecapData,
  type RecapFacts,
} from "./recap";

// ---------------------------------------------------------------- the clock ---

/** Result, MVP, playoff picture, share card. */
export const BROADCAST_BEATS = [3200, 2800, 3000, 3400];
export const BROADCAST_STARTS = [0, 3200, 6000, 9000];
export const BROADCAST_END = 12400;
export const BROADCAST_FADE = 600;
/** The stinger is mounted from this long before each boundary to this long after. */
export const STING_MS = 350;

/** Which beat a moment falls in. */
export function broadcastBeat(t: number): number {
  return t < BROADCAST_STARTS[1] ? 0 : t < BROADCAST_STARTS[2] ? 1 : t < BROADCAST_STARTS[3] ? 2 : 3;
}

/**
 * Where a tap goes: STING_MS before the next boundary, so the full stinger
 * still plays over the cut; past the last beat, the end.
 */
export function tapTarget(t: number): number {
  const next = BROADCAST_STARTS.slice(1).find((b) => b - STING_MS > t + 30);
  return next == null ? BROADCAST_END : next - STING_MS;
}

// ---------------------------------------------------------------- the table ---

export interface TableRow {
  id: string;
  wins: number;
  losses: number;
  ties: number;
  pct: number;
  pf: number;
  division: string | null;
  slot: string;
}

/** Every franchise's season through a week. */
export function tableThrough(data: RecapData, through: number): TableRow[] {
  return data.teams.map((t) => {
    const r = resultsThrough(data.games, t.id, through);
    const wins = r.filter((x) => x === "W").length;
    const ties = r.filter((x) => x === "T").length;
    const losses = r.length - wins - ties;
    return {
      id: t.id,
      wins,
      losses,
      ties,
      pct: r.length ? (wins + ties * 0.5) / r.length : 0,
      pf: pointsFor(data.games, t.id, through),
      division: t.division ?? null,
      slot: t.slot ?? t.id,
    };
  });
}

const better = (a: TableRow, b: TableRow) => b.pct - a.pct || b.pf - a.pf || a.slot.localeCompare(b.slot);

/**
 * Seed order through a week, the way the database's seeding() orders it:
 * each division's best by win percentage, points for and slot first, then
 * everybody else, each group ranked the same way.
 */
export function seedsThrough(data: RecapData, through: number): TableRow[] {
  const rows = tableThrough(data, through);
  const byDivision = new Map<string, TableRow[]>();
  for (const r of rows) {
    const key = r.division ?? "";
    byDivision.set(key, [...(byDivision.get(key) ?? []), r]);
  }
  const winners = new Set([...byDivision.values()].map((g) => [...g].sort(better)[0].id));
  return [...rows].sort((a, b) => Number(winners.has(b.id)) - Number(winners.has(a.id)) || better(a, b));
}

// -------------------------------------------------------------- the picture ---

export interface Picture {
  seedBefore: number;
  seedAfter: number;
  moved: number;
  /** "▲ 2", "▼ 1" or "HELD". */
  tag: string;
  tone: "up" | "down" | "held";
  note: string;
  kicker: string;
  number: string;
  clinchNote: string;
  /** Seed order after the week, for the rail. */
  rail: string[];
  field: number;
}

/**
 * The playoff picture after the week.
 *
 * In the field: the magic number is the regular season's length plus one,
 * less your wins, less the losses of the first team outside — any mix of that
 * many of your wins and their losses and they can no longer catch you. Out of
 * it: how many wins behind the last seed in, and the elimination number the
 * same way round.
 */
export function playoffPicture(data: RecapData, f: RecapFacts): Picture {
  const teams = data.teams.length;
  const field = Math.max(2, Math.min(data.playoffTeams ?? 6, teams));
  const regular = data.regularWeeks ?? f.week;
  const before = f.week > 1 ? seedsThrough(data, f.week - 1) : seedsThrough(data, 0);
  const after = seedsThrough(data, f.week);
  const seedBefore = before.findIndex((r) => r.id === data.meId) + 1;
  const seedAfter = after.findIndex((r) => r.id === data.meId) + 1;
  const moved = f.week > 1 ? seedBefore - seedAfter : 0;
  const me = after[seedAfter - 1];
  const team = (id: string) => data.teams.find((t) => t.id === id);

  const division = me.division;
  const divRank = after.filter((r) => r.division === division).findIndex((r) => r.id === me.id) + 1;
  const where = division ? ` · ${ordinal(divRank)} in the ${division}` : "";
  const note = (moved > 0 ? `Up from ${ordinal(seedBefore)}` : moved < 0 ? `Down from ${ordinal(seedBefore)}` : `Holding ${ordinal(seedAfter)}`) + where;

  let kicker: string;
  let number: string;
  let clinchNote: string;
  if (f.week > regular) {
    // The postseason: the table is frozen, and the only question is whether
    // this week's game kept the season going.
    kicker = "POSTSEASON";
    number = f.won ? "IN" : "OUT";
    clinchNote = f.won ? "Through to the next round." : "Your season ends here.";
  } else if (seedAfter <= field) {
    const chaser = after[field];
    const magic = chaser ? regular + 1 - me.wins - chaser.losses : 0;
    if (magic <= 0) {
      kicker = "CLINCHED";
      number = "✓";
      clinchNote = "A playoff spot is locked up.";
    } else {
      kicker = "MAGIC NUMBER";
      number = String(magic);
      clinchNote = `Any combination of ${magic} of your wins or ${team(chaser.id)?.franchise ?? "the chasers'"} losses locks up a playoff spot.`;
    }
  } else {
    const last = after[field - 1];
    const back = last.wins - me.wins;
    const elimination = regular + 1 - last.wins - me.losses;
    if (elimination <= 0) {
      kicker = "ELIMINATED";
      number = "—";
      clinchNote = "Out of the playoff race this season.";
    } else {
      kicker = back > 0 ? "GAMES BACK" : "OUT ON TIEBREAK";
      number = String(Math.max(0, back));
      clinchNote = `Chasing ${team(last.id)?.franchise ?? "the last seed"} for the ${ordinal(field)} seed. Elimination number ${elimination}.`;
    }
  }

  return {
    seedBefore,
    seedAfter,
    moved,
    tag: moved > 0 ? `▲ ${moved}` : moved < 0 ? `▼ ${-moved}` : "HELD",
    tone: moved > 0 ? "up" : moved < 0 ? "down" : "held",
    note,
    kicker,
    number,
    clinchNote,
    rail: after.map((r) => r.id),
    field,
  };
}

// ------------------------------------------------------------ the sentences ---

const streakText = (f: RecapFacts) => (f.streak.runs && f.streak.kind ? `${f.streak.kind}${f.streak.runs}` : "");

/** "Won by 12.4 · now 5-2 · W3". */
export function verdictLine(f: RecapFacts): string {
  const how = f.tied ? `Tied at ${f.myScore.toFixed(1)}` : `${f.won ? "Won" : "Lost"} by ${f.margin.toFixed(1)}`;
  return [how, `now ${f.record}`, streakText(f)].filter(Boolean).join(" · ");
}

/** Under five, or over twenty; otherwise nothing worth saying. */
export function verdictNote(f: RecapFacts): string {
  if (f.tied) return "";
  return f.margin < 5 ? "Decided by less than five points." : f.margin > 20 ? "Never in doubt." : "";
}

/** The lower third: the week's high score, and where yours sat. */
export function highScore(f: RecapFacts): { kicker: string; line: string; sub: string } | null {
  if (!f.top || !f.topTeam) return null;
  if (f.topIsMe) {
    const gap = f.runnerUp ? (f.top.points - f.runnerUp.points).toFixed(1) : "0.0";
    return {
      kicker: "HIGH SCORE OF THE WEEK · YOU",
      line: `Best in the league by ${gap}`,
      sub: f.runnerUpTeam && f.runnerUp ? `${f.runnerUpTeam.franchise} was next at ${f.runnerUp.points.toFixed(1)}` : "",
    };
  }
  return {
    kicker: "HIGH SCORE OF THE WEEK",
    line: `${f.topTeam.franchise} · ${f.topTeam.owner}`,
    sub: `Your ${f.myScore.toFixed(1)} was ${ordinal(f.myWeekRank)} of ${f.teamsInWeek}`,
  };
}

/** The MVP's note: carried it, led a balanced week, or not enough. */
export function mvpLine(f: RecapFacts): string {
  if (!f.mvp) return "";
  if (f.share > 25 && f.second) {
    return `Carried the week almost alone. Next best: ${f.second.name}, ${f.second.points.toFixed(1)}.`;
  }
  if (f.won) {
    const doubles = f.byPoints.filter((p) => p.points >= 10).length;
    return `Led a balanced week: ${doubles} players in double figures.`;
  }
  if (f.tied) return "Your best, and it still only drew.";
  return `Your best, and it still came up ${f.margin.toFixed(1)} short.`;
}

/** Next week's opponent: the earlier meeting, and how they score against you. */
export function nextLine(data: RecapData, f: RecapFacts): string {
  if (!f.next) return "";
  const them = f.next.team.id;
  const earlier = weeksIn(data.games).find((w) => w <= f.week && opponentIn(data.games, w, data.meId) === them);
  let meet = "First meeting this season.";
  if (earlier != null) {
    const mine = scoreIn(data.games, earlier, data.meId) ?? 0;
    const theirs = scoreIn(data.games, earlier, them) ?? 0;
    meet = mine > theirs ? "Rematch: you won the first meeting." : mine < theirs ? "Rematch: they won the first meeting." : "Rematch: the first meeting was a tie.";
  }
  const played = (id: string) => resultsThrough(data.games, id, f.week).length || 1;
  const theirAvg = f.next.pointsFor / played(them);
  const myAvg = f.myPointsFor / played(data.meId);
  const diff = theirAvg - myAvg;
  return `${meet} Averaging ${theirAvg.toFixed(1)}, ${Math.abs(diff).toFixed(1)} ${diff > 0 ? "more" : "less"} than you.`;
}

/** "W3" or "L1", for the next opponent's line. */
export function formOf(runs: number, kind: string): string {
  return runs && kind ? `${kind}${runs}` : "—";
}
