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
): { total: number; ppg: number; games: number } {
  const mine = league[name];
  if (mine && mine.games > 0) {
    return { total: mine.total, ppg: mine.total / mine.games, games: mine.games };
  }

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
): Row[] {
  return POOL.map((p) => {
    const points = pointsFor(p.n, p.p, p.t, league);
    return {
      name: p.n,
      position: p.p,
      team: p.t,
      bye: p.bye ?? null,
      franchise: rostered[p.n] ?? null,
      total: Math.round(points.total * 10) / 10,
      ppg: Math.round(points.ppg * 10) / 10,
      games: points.games,
      stats: statsFor(p.n, p.p, p.t),
    };
  }).sort((a, b) => b.total - a.total || b.ppg - a.ppg || a.name.localeCompare(b.name));
}

/** The rows a toggle shows. */
export function filter(rows: Row[], group: Group): Row[] {
  const positions = GROUPS[group];
  if (!positions) return rows;
  return rows.filter((r) => positions.includes(r.position));
}
