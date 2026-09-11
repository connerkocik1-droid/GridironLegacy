import { DEFENSE, FIN25, KICK, PASS, POOL, RECV, RUSH } from "@/data/league-data";

/**
 * Player rankings: what everyone has actually produced, and at what rate.
 *
 * Two different things share this table and it is worth being clear which is
 * which. Fantasy points are the league's own — its scoring settings, its
 * weeks — and come from what has been played here, falling back to last
 * season's finish before this one has started. The per-game rates beside them
 * are real football statistics from the 2025 season, because a fantasy league
 * does not produce passing yards; it only produces points.
 *
 * Every rate is per game played, not per game on the calendar. A back who
 * missed six weeks is judged on the eleven he was on the field for.
 */

export type Group = "ALL" | "QB" | "RB" | "WR" | "TE" | "FLEX" | "K" | "D/ST";

/** The positions each toggle covers. FLEX is what a flex slot will take. */
export const GROUPS: Record<Group, string[] | null> = {
  ALL: null,
  QB: ["QB"],
  RB: ["RB"],
  WR: ["WR"],
  TE: ["TE"],
  FLEX: ["RB", "WR", "TE"],
  K: ["K"],
  "D/ST": ["D/ST"],
};

export interface Column {
  key: string;
  label: string;
  /** Decimal places. Counting stats show none. */
  dp: number;
  title: string;
}

/** Total points and points per game are on every row, whatever the position. */
const BASE: Column[] = [
  { key: "total", label: "PTS", dp: 1, title: "Total fantasy points" },
  { key: "ppg", label: "PPG", dp: 1, title: "Fantasy points per game" },
];

/**
 * The statistics that mean something for each position, in the order they are
 * read. A quarterback is judged on volume and accuracy; a receiver on how
 * often the ball comes his way and what he does with it.
 */
export const COLUMNS: Record<Group, Column[]> = {
  ALL: BASE,
  QB: [
    ...BASE,
    { key: "pypg", label: "PYPG", dp: 1, title: "Passing yards per game" },
    { key: "tdpg", label: "TD/G", dp: 2, title: "Passing touchdowns per game" },
    { key: "compPct", label: "COMP %", dp: 1, title: "Completion percentage" },
    { key: "attpg", label: "ATT/G", dp: 1, title: "Pass attempts per game" },
    { key: "comppg", label: "COMP/G", dp: 1, title: "Completions per game" },
  ],
  RB: [
    ...BASE,
    { key: "attpg", label: "ATT/G", dp: 1, title: "Rushing attempts per game" },
    { key: "ypg", label: "YPG", dp: 1, title: "Rushing yards per game" },
    { key: "tdpg", label: "TD/G", dp: 2, title: "Touchdowns per game, rushing and receiving" },
    { key: "recpg", label: "REC/G", dp: 1, title: "Receptions per game" },
  ],
  WR: [
    ...BASE,
    { key: "tgtpg", label: "TGT/G", dp: 1, title: "Targets per game" },
    { key: "recpg", label: "REC/G", dp: 1, title: "Receptions per game" },
    { key: "ypr", label: "Y/R", dp: 1, title: "Yards per reception" },
    { key: "tdpg", label: "TD/G", dp: 2, title: "Receiving touchdowns per game" },
  ],
  TE: [
    ...BASE,
    { key: "tgtpg", label: "TGT/G", dp: 1, title: "Targets per game" },
    { key: "recpg", label: "REC/G", dp: 1, title: "Receptions per game" },
    { key: "ypr", label: "Y/R", dp: 1, title: "Yards per reception" },
    { key: "tdpg", label: "TD/G", dp: 2, title: "Receiving touchdowns per game" },
  ],
  // A flex row can be a back or a receiver, so it shows what both have:
  // yards from scrimmage, catches, and scores.
  FLEX: [
    ...BASE,
    { key: "scrimpg", label: "YPG", dp: 1, title: "Yards from scrimmage per game" },
    { key: "recpg", label: "REC/G", dp: 1, title: "Receptions per game" },
    { key: "tdpg", label: "TD/G", dp: 2, title: "Touchdowns per game" },
  ],
  K: [
    ...BASE,
    { key: "fgapg", label: "ATT/G", dp: 2, title: "Field goals attempted per game" },
    { key: "fgpg", label: "MADE/G", dp: 2, title: "Field goals made per game" },
    { key: "fg", label: "TOTAL FG", dp: 0, title: "Field goals made" },
  ],
  "D/ST": BASE,
};

export interface Row {
  name: string;
  position: string;
  team: string;
  bye: number | null;
  /** Franchise holding them, or null for a free agent. */
  franchise: string | null;
  total: number;
  ppg: number;
  games: number;
  stats: Record<string, number | null>;
}

/** Season fantasy points this league has actually awarded a player. */
export interface LeaguePoints {
  [player: string]: { total: number; games: number };
}

/**
 * What a player has actually done on the field this season.
 *
 * `line` is every counting statistic added across his weeks; `games` is how
 * many of those weeks recorded each one. Two numbers rather than one because a
 * back who never sees a target has no receiving games at all, and dividing his
 * receptions by the weeks he ran the ball would say he is a receiver who
 * catches nothing.
 */
export interface PlayedSeason {
  [player: string]: { line: Record<string, number>; games: Record<string, number> };
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Divide, or null when there is nothing to divide by. */
function per(value: number, games: number): number | null {
  if (!games) return null;
  return value / games;
}

/**
 * Where a player's fantasy points come from.
 *
 * The league's own scoring wins whenever it has any: those are the points that
 * decided real matchups here. Before a week has been played there are none,
 * and last season's finish is the only honest answer.
 */
function pointsFor(
  name: string,
  position: string,
  team: string,
  league: LeaguePoints,
  thisSeason: boolean,
): { total: number; ppg: number; games: number } {
  const mine = league[name];
  if (mine && mine.games > 0) {
    return { total: mine.total, ppg: mine.total / mine.games, games: mine.games };
  }

  // Once this league has scored a week, the board is this league's — and a
  // player it has not scored has nought, not last year's three hundred.
  //
  // Falling through to 2025 here put two seasons in one column and then
  // sorted them against each other, so after week one the top of the board
  // was whoever finished well last year and the men actually scoring were
  // buried under them. A board that mixes its bases is not a ranking of
  // anything.
  if (thisSeason) return { total: 0, ppg: 0, games: 0 };

  if (position === "D/ST") {
    const d = DEFENSE[team];
    if (d) return { total: num(d.fpts), ppg: num(d.ppg), games: num(d.gp) };
  }

  const k = KICK[name];
  if (k) return { total: num(k.fpts), ppg: num(k.ppg), games: num(k.gp) };

  const fin = FIN25[name];
  if (fin) return { total: num(fin.ttl), ppg: num(fin.avg), games: num(fin.gp) };

  return { total: 0, ppg: 0, games: 0 };
}

/**
 * The football statistics for a season this league has actually played.
 *
 * Read off the box scores the app already stores, rather than off last year's
 * tables. The board used to put this league's points beside last season's
 * football, which is how a receiver with one touchdown in his one game came
 * to read 0.59 TD/G — his 2025 rate, in a row headed by his 2026 points.
 */
function playedStats(
  played: { line: Record<string, number>; games: Record<string, number> },
  position: string,
): Record<string, number | null> {
  const { line, games } = played;
  const n = (key: string) => num(line[key]);
  const g = (key: string) => num(games[key]);

  if (position === "QB") {
    const gp = g("attempts");
    if (!gp) return {};
    return {
      pypg: per(n("passYards"), gp),
      tdpg: per(n("passTd"), gp),
      compPct: n("attempts") ? (n("completions") / n("attempts")) * 100 : null,
      attpg: per(n("attempts"), gp),
      comppg: per(n("completions"), gp),
    };
  }

  if (position === "K") {
    const gp = g("fgAttempted");
    if (!gp) return {};
    return {
      fgapg: per(n("fgAttempted"), gp),
      fgpg: per(n("fgMade"), gp),
      fg: n("fgMade"),
    };
  }

  if (position === "D/ST") return {};

  const rushGp = g("carries");
  const recvGp = g("receptions");
  const both = Math.max(rushGp, recvGp);
  if (!both) return {};

  const rec = n("receptions");

  return {
    attpg: per(n("carries"), rushGp),
    // Yards per game over the games he carried it, to match how the 2025
    // table counts them.
    ypg: per(n("rushYards"), rushGp),
    // Scoring is scoring, however he got there.
    tdpg: per(n("rushTd") + n("recTd"), both),
    recpg: per(rec, recvGp),
    tgtpg: per(n("targets"), recvGp),
    ypr: rec ? n("recYards") / rec : null,
    scrimpg: per(n("rushYards") + n("recYards"), both),
  };
}

/** The football statistics beside the points, from the 2025 season. */
function statsFor(name: string, position: string, team: string): Record<string, number | null> {
  const pass = PASS[name];
  const rush = RUSH[name];
  const recv = RECV[name];
  const kick = KICK[name];

  if (position === "QB") {
    if (!pass) return {};
    const gp = num(pass.gp);
    return {
      pypg: num(pass.ypg),
      tdpg: per(num(pass.td), gp),
      compPct: num(pass.pct),
      attpg: per(num(pass.att), gp),
      comppg: per(num(pass.cmp), gp),
    };
  }

  if (position === "K") {
    if (!kick) return {};
    const gp = num(kick.gp);
    return {
      fgapg: per(num(kick.fga), gp),
      fgpg: per(num(kick.fg), gp),
      fg: num(kick.fg),
    };
  }

  if (position === "D/ST") {
    return DEFENSE[team] ? {} : {};
  }

  // A back's games and a receiver's games are counted in different tables and
  // can disagree; each rate uses the games its own table recorded.
  const rushGp = num(rush?.gp);
  const recvGp = num(recv?.gp);
  const games = Math.max(rushGp, recvGp);

  const rushYds = num(rush?.yds);
  const recvYds = num(recv?.yds);
  const rec = num(recv?.rec);

  return {
    attpg: per(num(rush?.att), rushGp),
    ypg: rush ? num(rush.ypg) : null,
    // Scoring is scoring, however he got there: a back who catches two
    // touchdowns is not a worse back for it.
    tdpg: per(num(rush?.td) + num(recv?.td), games),
    recpg: per(rec, recvGp),
    tgtpg: per(num(recv?.tg), recvGp),
    ypr: rec ? recvYds / rec : null,
    scrimpg: per(rushYds + recvYds, games),
  };
}

/**
 * Every player in the pool as a ranking row, best first.
 *
 * Ranked on total points rather than per-game, because a season is what a
 * fantasy manager actually banks — a back averaging twenty over four games
 * did not win anyone a title.
 */
export function rank(
  league: LeaguePoints = {},
  rostered: Record<string, string> = {},
  /** Whether this league has played a week, and so has a season of its own. */
  thisSeason = false,
  /** The box scores of the weeks it has played, when it has played any. */
  played: PlayedSeason = {},
): Row[] {
  return POOL.map((p) => {
    const points = pointsFor(p.n, p.p, p.t, league, thisSeason);
    // Both halves of a row come from the same season or the row is a lie. A
    // man this league has not scored has no football either — an empty row is
    // the honest one, and it is what stops last year leaking into this one.
    const mine = played[p.n];
    const stats = thisSeason
      ? mine
        ? playedStats(mine, p.p)
        : {}
      : statsFor(p.n, p.p, p.t);
    return {
      name: p.n,
      position: p.p,
      team: p.t,
      bye: p.bye ?? null,
      franchise: rostered[p.n] ?? null,
      total: Math.round(points.total * 10) / 10,
      ppg: Math.round(points.ppg * 10) / 10,
      games: points.games,
      stats,
    };
  }).sort((a, b) => b.total - a.total || b.ppg - a.ppg || a.name.localeCompare(b.name));
}

/**
 * The board, ordered by whichever column the reader pressed.
 *
 * Descending first for every column, because on a rankings board the question
 * is always who is best, and "sort by points" meaning "show me the worst
 * players first" is a thing nobody has ever wanted. Pressing the same column
 * again turns it round.
 *
 * A player with no value in the column always sinks, whichever way it is
 * sorted. Absent is not zero — a receiver with no completion percentage has
 * not thrown badly, he has not thrown — and floating those rows to the top on
 * an ascending sort buries the answer under two hundred dashes.
 */
export function sortRows(rows: Row[], key: string, ascending: boolean): Row[] {
  const valueOf = (r: Row): number | null => {
    if (key === "total") return r.total;
    if (key === "ppg") return r.ppg;
    if (key === "name") return null;
    const v = r.stats[key];
    return v == null || !Number.isFinite(v) ? null : v;
  };

  if (key === "name") {
    return [...rows].sort(
      (a, b) => a.name.localeCompare(b.name) * (ascending ? 1 : -1),
    );
  }

  return [...rows].sort((a, b) => {
    const x = valueOf(a);
    const y = valueOf(b);
    if (x == null && y == null) return a.name.localeCompare(b.name);
    if (x == null) return 1;
    if (y == null) return -1;
    if (x !== y) return ascending ? x - y : y - x;
    // A tie on the column asked for falls back to the season, which is what
    // the board is about, and then to the alphabet so the order never wobbles
    // between renders.
    return b.total - a.total || a.name.localeCompare(b.name);
  });
}

/** The rows a toggle shows. */
export function filter(rows: Row[], group: Group): Row[] {
  const positions = GROUPS[group];
  if (!positions) return rows;
  return rows.filter((r) => positions.includes(r.position));
}
