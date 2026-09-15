/**
 * The week recap: when it plays, and everything it says.
 *
 * Two separable things live here, and both are pure so they can be tested
 * without a browser or a database.
 *
 * The first is *when*. The NFL week ends on Monday night, so the recap belongs
 * to Tuesday — and the app has to agree with the league about when Tuesday is,
 * which is Tuesday in New York, not Tuesday wherever the manager happens to be
 * standing. A manager in Sydney opening the app on their Tuesday morning has
 * not reached the end of the football week yet.
 *
 * The second is *what*. Nothing the recap says is authored copy: every
 * sentence, badge and number falls out of the same fixtures and scores the
 * League screen reads. The MVP is derived rather than nominated, the margin
 * line branches on the margin, the streak line special-cases a streak of one,
 * and so on — a screen of generated sentences goes wrong the moment one of
 * them is flattened into a single string that is true in one case.
 */

const ET = "America/New_York";

/** An instant's wall-clock fields as they read in New York. */
function etFields(at: number): { y: number; m: number; d: number; h: number; mi: number; s: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(at));

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  // Midnight formats as hour 24 rather than 0 in some ICU versions.
  return { y: get("year"), m: get("month"), d: get("day"), h: get("hour") % 24, mi: get("minute"), s: get("second") };
}

/**
 * The instant at which a wall-clock New York time occurs.
 *
 * Guess in UTC, see where the guess actually lands in New York, and correct by
 * the difference. Twice, because the correction itself can cross a daylight
 * saving boundary — the second pass lands on the right side of it.
 */
function etInstant(y: number, m: number, d: number, h = 0): number {
  const target = Date.UTC(y, m - 1, d, h);
  let guess = target;
  for (let pass = 0; pass < 2; pass++) {
    const f = etFields(guess);
    guess += target - Date.UTC(f.y, f.m - 1, f.d, f.h, f.mi, f.s);
  }
  return guess;
}

/** 0 for Sunday through 6 for Saturday, in New York. */
function etWeekday(at: number): number {
  const f = etFields(at);
  return new Date(Date.UTC(f.y, f.m - 1, f.d)).getUTCDay();
}

/**
 * When the recap for a week is allowed to play: the first Tuesday midnight in
 * New York strictly after the week's last kickoff.
 *
 * Anchored on the kickoff rather than on when the week was graded. Grading is
 * a job that runs when the last game ends, so it lands late on Monday night in
 * a normal week and at some arbitrary hour in an abnormal one — and a recap
 * whose availability moved with the cron would fire at 11:45 on a Monday one
 * week and be a day late the next. The last kickoff is football, and football
 * is what the manager is waiting for.
 *
 * With no fixtures on record — an imported season, a league playing to its own
 * schedule — grading is all there is to go on, and a graded week means the
 * football is over.
 */
export function recapOpensAt(lastKickoff: string | null, gradedAt: string | null): number | null {
  const kick = lastKickoff ? Date.parse(lastKickoff) : NaN;
  if (!Number.isFinite(kick)) {
    const graded = gradedAt ? Date.parse(gradedAt) : NaN;
    return Number.isFinite(graded) ? graded : null;
  }

  const f = etFields(kick);
  const midnight = etInstant(f.y, f.m, f.d);
  // Days to the next Tuesday. A game that kicks off on a Tuesday — which the
  // NFL does not do, but a rescheduled game could — waits for the one after,
  // because the week it belongs to has not finished being played.
  const ahead = ((2 - etWeekday(kick) + 7) % 7) || 7;
  return midnight + ahead * 86_400_000;
}

/** Whether this manager has a recap waiting for them right now. */
export function recapIsDue({
  week,
  seenWeek,
  opensAt,
  now = Date.now(),
}: {
  week: number | null;
  seenWeek: number | null;
  opensAt: number | null;
  now?: number;
}): boolean {
  if (week == null || opensAt == null) return false;
  if (now < opensAt) return false;
  return (seenWeek ?? 0) < week;
}

// ------------------------------------------------------------- the figures ---

export interface RecapTeam {
  id: string;
  franchise: string;
  /** The manager's own name. A franchise is who you play; this is who they are. */
  owner: string;
}

/** One graded fixture. Only settled weeks belong here. */
export interface RecapGame {
  week: number;
  home: string;
  away: string;
  homePoints: number;
  awayPoints: number;
  /**
   * A postseason game. It happened, so the week it belongs to can be recapped
   * in full — but it is not part of the season's record, points for or table,
   * for the same reason the standings stopped counting it: a bracket is not a
   * league table, and a team knocked out in the first round would otherwise
   * read as having lost a regular-season game.
   */
  playoff?: boolean;
}

/** The games a season's record is made of. */
const seasonGames = (games: RecapGame[]) => games.filter((g) => !g.playoff);

/** One of your own players in the week just played, as it actually graded. */
export interface RecapPlayer {
  name: string;
  position: string;
  team: string;
  points: number;
}

export interface RecapData {
  /** The week being recapped. */
  week: number;
  meId: string;
  teams: RecapTeam[];
  games: RecapGame[];
  /** The best-ball lineup that was graded, highest first is not assumed. */
  myWeek: RecapPlayer[];
  /** Next week's fixture, if the schedule has one. */
  next: { week: number; opponentId: string; kickoff: string | null } | null;
}

export type Result = "W" | "L" | "T";

/** Who a team played in a week, or null for a bye. */
export function opponentIn(games: RecapGame[], week: number, team: string): string | null {
  for (const g of games) {
    if (g.week !== week) continue;
    if (g.home === team) return g.away;
    if (g.away === team) return g.home;
  }
  return null;
}

/** What a team scored in a week, or null if they did not play it. */
export function scoreIn(games: RecapGame[], week: number, team: string): number | null {
  for (const g of games) {
    if (g.week !== week) continue;
    if (g.home === team) return g.homePoints;
    if (g.away === team) return g.awayPoints;
  }
  return null;
}

/** Every graded week, oldest first. */
export function weeksIn(games: RecapGame[]): number[] {
  return [...new Set(games.map((g) => g.week))].sort((a, b) => a - b);
}

/** A team's results up to and including a week, oldest first. */
export function resultsThrough(all: RecapGame[], team: string, through: number): Result[] {
  const games = seasonGames(all);
  const out: Result[] = [];
  for (const week of weeksIn(games)) {
    if (week > through) break;
    const mine = scoreIn(games, week, team);
    const opp = opponentIn(games, week, team);
    if (mine == null || opp == null) continue;
    const theirs = scoreIn(games, week, opp);
    if (theirs == null) continue;
    out.push(mine > theirs ? "W" : mine < theirs ? "L" : "T");
  }
  return out;
}

/** "3-1" or "3-1-1" — the tie only shows when there is one. */
export function recordOf(games: RecapGame[], team: string, through: number): string {
  const r = resultsThrough(games, team, through);
  const w = r.filter((x) => x === "W").length;
  const t = r.filter((x) => x === "T").length;
  const l = r.length - w - t;
  return t ? `${w}-${l}-${t}` : `${w}-${l}`;
}

/** How many of the most recent results are the same, and which. */
export function streakOf(results: Result[]): { runs: number; kind: Result | "" } {
  if (!results.length) return { runs: 0, kind: "" };
  const kind = results[results.length - 1];
  let runs = 0;
  for (let k = results.length - 1; k >= 0 && results[k] === kind; k--) runs++;
  return { runs, kind };
}

/** Points scored up to and including a week. */
export function pointsFor(all: RecapGame[], team: string, through: number): number {
  const games = seasonGames(all);
  let total = 0;
  for (const week of weeksIn(games)) {
    if (week > through) break;
    total += scoreIn(games, week, team) ?? 0;
  }
  return Math.round(total * 10) / 10;
}

/** Team ids in standings order after a week: wins first, points for as tiebreak. */
export function standingAfter(data: RecapData, through: number): string[] {
  return data.teams
    .map((t) => {
      const r = resultsThrough(data.games, t.id, through);
      return {
        id: t.id,
        wins: r.filter((x) => x === "W").length + r.filter((x) => x === "T").length * 0.5,
        pf: pointsFor(data.games, t.id, through),
      };
    })
    .sort((a, b) => b.wins - a.wins || b.pf - a.pf)
    .map((x) => x.id);
}

/** Every franchise that played a week, highest score first. */
export function weekBoard(data: RecapData, week: number): { id: string; points: number }[] {
  const out: { id: string; points: number }[] = [];
  for (const g of data.games) {
    if (g.week !== week) continue;
    out.push({ id: g.home, points: g.homePoints });
    out.push({ id: g.away, points: g.awayPoints });
  }
  return out.sort((a, b) => b.points - a.points);
}

/** "1st", "2nd", "11th" — the exceptions are the teens. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const ones = n % 10;
  return `${n}${ones === 1 ? "st" : ones === 2 ? "nd" : ones === 3 ? "rd" : "th"}`;
}

export interface RecapFacts {
  week: number;
  me: RecapTeam;
  opponent: RecapTeam | null;
  myScore: number;
  theirScore: number;
  won: boolean;
  tied: boolean;
  margin: number;
  /** Every graded result of this manager's, oldest first. */
  results: Result[];
  streak: { runs: number; kind: Result | "" };
  record: string;
  myPointsFor: number;

  board: { id: string; points: number }[];
  top: { id: string; points: number } | null;
  runnerUp: { id: string; points: number } | null;
  topTeam: RecapTeam | null;
  runnerUpTeam: RecapTeam | null;
  topRecord: string;
  topIsMe: boolean;
  myWeekRank: number;
  teamsInWeek: number;

  mvp: RecapPlayer | null;
  second: RecapPlayer | null;
  byPoints: RecapPlayer[];
  teamTotal: number;
  share: number;
  over20: number;

  rankBefore: number;
  rankAfter: number;
  moved: number;
  teamCount: number;

  next: {
    week: number;
    team: RecapTeam;
    record: string;
    pointsFor: number;
    streak: { runs: number; kind: Result | "" };
    rematch: boolean;
    kickoff: string | null;
  } | null;
}

/**
 * Every figure the recap shows, worked out once.
 *
 * The clock ticks about seventeen times a second while the recap plays, and
 * none of this depends on the clock — sorting the league four hundred times to
 * draw the same standings four hundred times is work nobody asked for. The
 * split between what the clock changes and what it does not is the reason the
 * animation stays smooth on a phone.
 */
export function recapFacts(data: RecapData): RecapFacts | null {
  const teamById = new Map(data.teams.map((t) => [t.id, t]));
  const me = teamById.get(data.meId);
  if (!me) return null;

  const week = data.week;
  const myScore = scoreIn(data.games, week, data.meId);
  // No fixture in the week being recapped is a bye, and a bye has no result to
  // recap. The caller decides not to play rather than playing an empty one.
  if (myScore == null) return null;

  const oppId = opponentIn(data.games, week, data.meId);
  const opponent = oppId ? (teamById.get(oppId) ?? null) : null;
  const theirScore = oppId ? (scoreIn(data.games, week, oppId) ?? 0) : 0;

  const board = weekBoard(data, week);
  const top = board[0] ?? null;
  const runnerUp = board[1] ?? null;
  const results = resultsThrough(data.games, data.meId, week);

  const byPoints = [...data.myWeek].sort((a, b) => b.points - a.points || a.name.localeCompare(b.name));
  const teamTotal = Math.round(byPoints.reduce((sum, p) => sum + p.points, 0) * 10) / 10;

  const before = standingAfter(data, week - 1).indexOf(data.meId) + 1;
  const after = standingAfter(data, week).indexOf(data.meId) + 1;

  const nextOpp = data.next ? teamById.get(data.next.opponentId) : null;
  const nextResults = nextOpp ? resultsThrough(data.games, nextOpp.id, week) : [];

  return {
    week,
    me,
    opponent,
    myScore,
    theirScore,
    won: myScore > theirScore,
    tied: myScore === theirScore,
    margin: Math.round(Math.abs(myScore - theirScore) * 10) / 10,
    results,
    streak: streakOf(results),
    record: recordOf(data.games, data.meId, week),
    myPointsFor: pointsFor(data.games, data.meId, week),

    board,
    top,
    runnerUp,
    topTeam: top ? (teamById.get(top.id) ?? null) : null,
    runnerUpTeam: runnerUp ? (teamById.get(runnerUp.id) ?? null) : null,
    topRecord: top ? recordOf(data.games, top.id, week) : "",
    topIsMe: top?.id === data.meId,
    myWeekRank: board.findIndex((x) => x.id === data.meId) + 1,
    teamsInWeek: board.length,

    mvp: byPoints[0] ?? null,
    second: byPoints[1] ?? null,
    byPoints,
    teamTotal,
    share: teamTotal > 0 && byPoints[0] ? (byPoints[0].points / teamTotal) * 100 : 0,
    over20: data.myWeek.filter((p) => p.points >= 20).length,

    rankBefore: before,
    rankAfter: after,
    moved: before - after,
    teamCount: data.teams.length,

    next:
      data.next && nextOpp
        ? {
            week: data.next.week,
            team: nextOpp,
            record: recordOf(data.games, nextOpp.id, week),
            pointsFor: pointsFor(data.games, nextOpp.id, week),
            streak: streakOf(nextResults),
            // Already seen once, which changes how the line reads.
            rematch: weeksIn(data.games).some(
              (w) => w < week && opponentIn(data.games, w, data.meId) === nextOpp.id,
            ),
            kickoff: data.next.kickoff,
          }
        : null,
  };
}

// ------------------------------------------------------------- the sentences ---

/** The line under the scores. Branches on how close it was. */
export function marginLine(f: RecapFacts): string {
  if (f.tied) return `Tied at ${f.myScore.toFixed(1)} — a week neither of you won`;
  const how = f.won ? "Won by " : "Lost by ";
  const tail = f.margin < 5 ? " — the closest week of your season" : f.margin > 20 ? " — never in doubt" : "";
  return `${how}${f.margin.toFixed(1)}${tail}`;
}

/** The streak strip's sentence. A streak of one is its own case. */
export function streakLine(f: RecapFacts): string {
  const { runs, kind } = f.streak;
  const season = `${f.record} on the season`;
  if (!runs || !kind) return season;
  if (runs === 1) {
    if (kind === "W") return `Back in the win column · ${season}`;
    if (kind === "L") return `First loss after a win · ${season}`;
    return `A tie breaks the run · ${season}`;
  }
  const word = kind === "W" ? "straight wins" : kind === "L" ? "straight losses" : "straight ties";
  return `${runs} ${word} · ${season}`;
}

/** Beat two's read: whether the week's best score was yours. */
export function topScoreLine(f: RecapFacts): string {
  if (!f.top || !f.topTeam) return "";
  const clear = f.runnerUp ? (f.top.points - f.runnerUp.points).toFixed(1) : "0.0";
  if (f.topIsMe) {
    return f.runnerUpTeam
      ? `Nobody in the league scored more. ${clear} clear of ${f.runnerUpTeam.owner} in second.`
      : "Nobody in the league scored more.";
  }
  return (
    `${f.topTeam.owner} put up the week's best, ${clear} clear of second. ` +
    `Your ${f.myScore.toFixed(1)} came in ${ordinal(f.myWeekRank)} of ${f.teamsInWeek}.`
  );
}

/** Beat three's note. Branches three ways on what the MVP's week was. */
export function mvpNote(f: RecapFacts): string {
  if (!f.mvp) return "";
  if (f.share > 25 && f.second) {
    return `Carried the week almost alone — no other player of yours cleared ${f.second.points.toFixed(1)}.`;
  }
  if (f.won) return `Top of a balanced week: ${f.over20} of your players cleared 20.`;
  if (f.tied) return `Your best week from anyone, and it still only drew.`;
  return `Your best week from anyone, and it still was not enough by ${f.margin.toFixed(1)}.`;
}

/** Beat four's standings note. Branches on which way you went. */
export function standingsNote(f: RecapFacts): string {
  const pf = f.myPointsFor.toFixed(1);
  if (f.moved === 0) return `Same seat as last week. ${f.record} with ${pf} points for.`;
  if (f.moved > 0) return `Climbed to ${f.rankAfter} of ${f.teamCount} on ${f.record} and ${pf} points for.`;
  return `Slipped to ${f.rankAfter} of ${f.teamCount}. Points for still reads ${pf}.`;
}

/** Beat four's read on next week's opponent. */
export function nextOpponentLine(f: RecapFacts): string {
  if (!f.next) return "";
  const { team, streak, pointsFor: theirs, rematch } = f.next;
  const form =
    streak.runs === 0 || !streak.kind
      ? "comes in yet to play a week"
      : streak.runs === 1
        ? `comes in off a ${streak.kind === "W" ? "win" : streak.kind === "L" ? "loss" : "tie"}`
        : `comes in on ${streak.runs} straight ${streak.kind === "W" ? "wins" : streak.kind === "L" ? "losses" : "ties"}`;

  const gap = Math.round(Math.abs(theirs - f.myPointsFor) * 10) / 10;
  const scoring =
    gap === 0
      ? "and exactly as many points scored as you."
      : theirs > f.myPointsFor
        ? `and ${gap.toFixed(1)} more points scored than you.`
        : `and ${gap.toFixed(1)} fewer points scored than you.`;

  return `${rematch ? "You have already seen them once. " : ""}${team.owner} ${form} ${scoring}`;
}

// ---------------------------------------------------------------- the clock ---

/** How long each beat holds the screen, in order. */
export const BEAT_MS = [4200, 4400, 4400, 5000];

/** The dismiss transition. */
export const FADE_MS = 900;

/**
 * Cumulative beat boundaries and the moment the recap closes itself.
 *
 * Derived from per-beat durations rather than written out, so retiming a beat
 * is one number and the boundaries after it cannot be left disagreeing.
 */
export function beatPlan(durations: number[] = BEAT_MS): { starts: number[]; end: number } {
  const starts = [0];
  for (let k = 1; k < durations.length; k++) starts.push(starts[k - 1] + durations[k - 1]);
  return { starts, end: durations.reduce((a, b) => a + b, 0) };
}

/** Which beat a moment falls in. */
export function beatAt(t: number, starts: number[]): number {
  let beat = 0;
  starts.forEach((start, n) => {
    if (t >= start) beat = n;
  });
  return beat;
}
