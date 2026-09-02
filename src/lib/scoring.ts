import type { GameDetail, PlayerStat, ScoringPlay } from "./espn";
import { NameIndex } from "./player-names";

export type ScoringFormat = "standard" | "half" | "ppr";

/** Points per reception, from the league's own `scoring` setting. */
const PPR: Record<ScoringFormat, number> = { standard: 0, half: 0.5, ppr: 1 };

/**
 * The league's scoring rules, in one place.
 *
 * Every number the app turns a statistic into a point with is here. Nothing
 * below invents a value of its own — if a rule is not in this table, the app
 * does not score it.
 */
export const SCORING_RULES = {
  passYardsPer: 25,
  passTd: 4,
  interception: -2,
  rushRecYardsPer: 10,
  rushRecTd: 6,
  fumbleLost: -2,
  /** To the man who carried or caught it in, and to the man who threw it. */
  twoPoint: 2,
  xp: 1,
  xpMissed: -1,
  fgUnder50: 3,
  fg50Plus: 5,
  fgMissed: -1,
} as const;

export type ScoringRules = typeof SCORING_RULES;

const RULES = SCORING_RULES;

/**
 * ESPN writes compound stats as "24/38" (completions/attempts) or "2/3"
 * (field goals made/attempted). Only the numerator is ever scored.
 */
function num(value: string | undefined): number {
  if (!value) return 0;
  const first = value.split("/")[0].replace(/[^\d.-]/g, "");
  const parsed = Number(first);
  return Number.isFinite(parsed) ? parsed : 0;
}

function made(value: string | undefined): [number, number] {
  if (!value) return [0, 0];
  const [m, a] = value.split("/");
  return [num(m), num(a)];
}

/**
 * What a kicker's day is worth.
 *
 * `distances` is the length of every field goal he actually made, read off the
 * scoring summary. That matters because the box score gives only "3/4" and a
 * single LONG, so a day of two fifty-yarders and a chip shot looks exactly
 * like one fifty-yarder and two chip shots — and they are two points apart.
 *
 * With no distances to hand it falls back to the box score's LONG, which can
 * award the bonus once at most. That is the old behaviour, kept as the floor:
 * the summary is a refinement, never the thing the score depends on.
 */
export function fieldGoalPoints(
  fgMade: number,
  fgAttempted: number,
  distances: number[],
  longFallback: number,
): number {
  const misses = Math.max(0, fgAttempted - fgMade) * RULES.fgMissed;

  // Only trusted when it accounts for every kick he is credited with. A
  // partial list would quietly drop made field goals.
  if (distances.length === fgMade) {
    return distances.reduce((sum, d) => sum + (d >= 50 ? RULES.fg50Plus : RULES.fgUnder50), 0) + misses;
  }

  const bonus = longFallback >= 50 ? RULES.fg50Plus - RULES.fgUnder50 : 0;
  return fgMade * RULES.fgUnder50 + bonus + misses;
}

/**
 * Fantasy points for one stat group. ESPN's labels are the column headers of
 * its own box score, so an unrecognised group scores zero rather than guessing.
 *
 * `distances` is optional and only read for the kicking group.
 */
export function scoreGroup(
  stat: PlayerStat,
  format: ScoringFormat,
  distances?: number[],
): number {
  const s = stat.stats;

  switch (stat.group) {
    case "passing":
      return (
        num(s.YDS) / RULES.passYardsPer +
        num(s.TD) * RULES.passTd +
        num(s.INT) * RULES.interception
      );

    case "rushing":
      return num(s.YDS) / RULES.rushRecYardsPer + num(s.TD) * RULES.rushRecTd;

    case "receiving":
      return (
        num(s.YDS) / RULES.rushRecYardsPer +
        num(s.TD) * RULES.rushRecTd +
        num(s.REC) * PPR[format]
      );

    case "fumbles":
      return num(s.LOST) * RULES.fumbleLost;

    case "kicking": {
      const [fgMade, fgAtt] = made(s.FG);
      const [xpMade, xpAtt] = made(s.XP);
      return (
        fieldGoalPoints(fgMade, fgAtt, distances ?? [], num(s.LONG)) +
        xpMade * RULES.xp +
        Math.max(0, xpAtt - xpMade) * RULES.xpMissed
      );
    }

    default:
      // Return yardage included: a punt returned for a touchdown is the
      // defence's score, not the returner's, and it is counted there.
      return 0;
  }
}

/**
 * Points allowed is the single largest term in a defensive score, and it is a
 * band rather than a rate. Ordered high to low so the first match wins.
 */
const POINTS_ALLOWED: [max: number, points: number][] = [
  [0, 10],
  [6, 7],
  [13, 4],
  [20, 1],
  [27, 0],
  [34, -1],
  [Infinity, -4],
];

const DEFENSE_RULES = {
  sack: 1,
  interception: 2,
  fumbleRecovery: 2,
  safety: 2,
  touchdown: 6,
};

export interface DefenseScore {
  points: number;
  statLine: string;
}

/** What the summary can tell a defence that its own box-score lines cannot. */
export interface DefenseExtras {
  /**
   * Fumbles the opposing offence lost — which is, by definition, the number
   * this defence recovered.
   *
   * Read from the other side of the box score rather than from this one: a
   * team's own `fumbles` group counts a lineman falling on his quarterback's
   * fumble as a recovery, and that is not a takeaway.
   */
  fumblesRecovered?: number;
  /** Safeties this defence scored, from the scoring summary. */
  safeties?: number;
  /** Kick and punt returns taken back for a touchdown. */
  returnTouchdowns?: number;
}

/**
 * A team defense, scored from its players' box-score lines plus the points its
 * opponent put up. ESPN has no D/ST row — it reports defenders individually —
 * so the unit is assembled here from every defender on that team.
 */
export function scoreDefense(
  stats: PlayerStat[],
  teamAbbrev: string,
  pointsAllowed: number,
  extras: DefenseExtras = {},
): DefenseScore {
  let sacks = 0;
  let interceptions = 0;
  let ownFumbleRecoveries = 0;
  let touchdowns = 0;

  for (const stat of stats) {
    if (stat.team !== teamAbbrev) continue;
    const s = stat.stats;

    if (stat.group === "defensive") {
      // ESPN reports half-sacks as 0.5, so this is a sum, not a count.
      sacks += num(s.SACKS);
      touchdowns += num(s.TD);
    } else if (stat.group === "interceptions") {
      interceptions += num(s.INT);
      touchdowns += num(s.TD);
    } else if (stat.group === "fumbles") {
      ownFumbleRecoveries += num(s.REC);
    }
  }

  // The opposing offence's lost fumbles when we have them, which counts only
  // takeaways; this team's own REC column when we do not, which over-counts a
  // recovery of its own fumble but is the only figure available.
  const fumbleRecoveries = extras.fumblesRecovered ?? ownFumbleRecoveries;
  const safeties = extras.safeties ?? 0;
  touchdowns += extras.returnTouchdowns ?? 0;

  const band = POINTS_ALLOWED.find(([max]) => pointsAllowed <= max);
  const allowedPoints = band ? band[1] : 0;

  const points =
    sacks * DEFENSE_RULES.sack +
    interceptions * DEFENSE_RULES.interception +
    fumbleRecoveries * DEFENSE_RULES.fumbleRecovery +
    safeties * DEFENSE_RULES.safety +
    touchdowns * DEFENSE_RULES.touchdown +
    allowedPoints;

  const safetyNote = safeties ? ` · ${safeties} SFTY` : "";

  return {
    points: Math.round(points * 100) / 100,
    statLine:
      `${sacks} sacks · ${interceptions} INT · ${fumbleRecoveries} FR${safetyNote}` +
      ` · ${touchdowns} TD · ${pointsAllowed} allowed`,
  };
}

export interface ScoredPlayer {
  name: string;
  team: string;
  points: number;
  statLine: string;
}

/** Everything read out of one game, ready to be written or shown. */
export interface GameScores {
  /** Offensive players, keyed by the caller's own spelling of the name. */
  players: ScoredPlayer[];
  /** Team defenses, by team abbreviation. */
  defenses: Map<string, DefenseScore>;
  /**
   * Things the summary proved happened but could not pin on a player —
   * a two-point conversion whose wording nobody recognised. Logged rather
   * than guessed at, because a point awarded to the wrong manager is worse
   * than a point awarded late.
   */
  unattributed: string[];
}

/**
 * Rolls every stat group for a player into one score. A player appears in
 * several groups in one game (a running back who also catches passes), so the
 * groups are summed per name.
 *
 * `rostered`, when given, is matched on a normalised key rather than by string
 * equality — see player-names.ts for why that is not optional.
 */
export function scoreGame(
  stats: PlayerStat[],
  format: ScoringFormat,
  rostered?: Set<string> | NameIndex,
  extras?: { fieldGoals?: Map<string, number[]>; twoPointers?: Map<string, number> },
): ScoredPlayer[] {
  const index =
    rostered == null
      ? null
      : rostered instanceof NameIndex
        ? rostered
        : new NameIndex(rostered);

  const byPlayer = new Map<string, ScoredPlayer>();

  for (const stat of stats) {
    // The league's spelling wins, so every table stays keyed by one name.
    const name = index ? index.lookup(stat.name) : stat.name;
    if (!name) continue;

    const points = scoreGroup(stat, format, extras?.fieldGoals?.get(stat.name));
    const line = summarize(stat);
    const existing = byPlayer.get(name);

    if (existing) {
      existing.points += points;
      if (line) existing.statLine = existing.statLine ? `${existing.statLine} · ${line}` : line;
    } else {
      byPlayer.set(name, { name, team: stat.team, points, statLine: line });
    }
  }

  // Conversions land on players who already have a line from the box score;
  // a two-point conversion is always somebody's carry or catch.
  for (const [espnName, count] of extras?.twoPointers ?? []) {
    const name = index ? index.lookup(espnName) : espnName;
    const row = name ? byPlayer.get(name) : undefined;
    if (!row) continue;
    row.points += count * RULES.twoPoint;
    row.statLine = row.statLine ? `${row.statLine} · ${count} 2PT` : `${count} 2PT`;
  }

  for (const player of byPlayer.values()) {
    player.points = Math.round(player.points * 100) / 100;
  }

  return [...byPlayer.values()];
}

/** The human-readable line shown beside a score, in the group's own vocabulary. */
function summarize(stat: PlayerStat): string {
  const s = stat.stats;

  switch (stat.group) {
    case "passing":
      return `${s["C/ATT"] ?? ""} ${num(s.YDS)} yds ${num(s.TD)} TD`.trim();
    case "rushing":
      return `${num(s.CAR)} car ${num(s.YDS)} yds ${num(s.TD)} TD`;
    case "receiving":
      return `${num(s.REC)} rec ${num(s.YDS)} yds ${num(s.TD)} TD`;
    case "kicking":
      return `${s.FG ?? ""} FG ${s.XP ?? ""} XP`.trim();
    default:
      return "";
  }
}

// ---------------------------------------------------------------------------
// Reading the scoring summary
//
// Everything below parses ESPN's prose. It is all optional: each reader
// returns nothing when the wording is not one it knows, and the caller falls
// back to the box score. Corrections, never foundations.
// ---------------------------------------------------------------------------

/** "Harrison Butker 54 Yd Field Goal" -> Butker made one from 54. */
const FIELD_GOAL = /^(.+?)\s+(\d{1,2})\s*Yd\s+Field\s+Goal/i;

/** Distances of every field goal made, by the kicker's name as ESPN spells it. */
export function readFieldGoals(plays: ScoringPlay[]): Map<string, number[]> {
  const out = new Map<string, number[]>();

  for (const play of plays) {
    if (play.type && play.type.toUpperCase() !== "FG") continue;
    const match = FIELD_GOAL.exec(play.text.trim());
    if (!match) continue;

    const kicker = match[1].trim();
    const yards = Number(match[2]);
    if (!kicker || !Number.isFinite(yards)) continue;

    out.set(kicker, [...(out.get(kicker) ?? []), yards]);
  }

  return out;
}

/** Safeties scored, by the abbreviation of the team whose defence scored it. */
export function readSafeties(plays: ScoringPlay[]): Map<string, number> {
  const out = new Map<string, number>();

  for (const play of plays) {
    const isSafety = play.type.toUpperCase() === "SF" || /\bsafety\b/i.test(play.text);
    if (!isSafety || !play.team) continue;
    out.set(play.team, (out.get(play.team) ?? 0) + 1);
  }

  return out;
}

/**
 * The two forms ESPN writes a successful conversion in. Both name the man who
 * took it into the end zone last, which is who the two points belong to along
 * with the passer, if there was one.
 */
const TWO_POINT_PASS = /\(([^)]*?)\bpass\b[^)]*?\bto\b\s+([^,)]+?)\s+for\s+two[- ]point/i;
const TWO_POINT_RUN = /\(([^)]*?)\s+run\s+for\s+two[- ]point/i;

export interface TwoPointRead {
  /** How many conversions each player is credited with, by ESPN's spelling. */
  scorers: Map<string, number>;
  /** Conversions the scoreboard proved but the wording did not explain. */
  unattributed: number;
}

/**
 * Who converted, and how many conversions could not be pinned on anyone.
 *
 * The scoreboard says a conversion happened — a touchdown drive worth eight
 * rather than seven — with no interpretation at all. Only the question of
 * *who* needs the prose, and when the prose does not answer it the conversion
 * is counted as unattributed rather than handed to the likeliest candidate.
 */
export function readTwoPointConversions(plays: ScoringPlay[]): TwoPointRead {
  const scorers = new Map<string, number>();
  let unattributed = 0;

  const credit = (name: string) => {
    const clean = name.trim().replace(/\s+/g, " ");
    if (!clean) return false;
    scorers.set(clean, (scorers.get(clean) ?? 0) + 1);
    return true;
  };

  for (const play of plays) {
    // Eight points off one touchdown is a conversion, and nothing else is.
    if (play.value !== 8) continue;

    const pass = TWO_POINT_PASS.exec(play.text);
    if (pass) {
      // The passer and the receiver both, which is how the two points are
      // awarded everywhere they are awarded at all.
      const passer = credit(pass[1].replace(/\bpass\b.*$/i, ""));
      const receiver = credit(pass[2]);
      if (passer || receiver) continue;
    }

    const run = TWO_POINT_RUN.exec(play.text);
    if (run && credit(run[1])) continue;

    unattributed++;
  }

  return { scorers, unattributed };
}

/** Kick and punt returns taken to the house, by the returning team. */
export function readReturnTouchdowns(stats: PlayerStat[]): Map<string, number> {
  const out = new Map<string, number>();

  for (const stat of stats) {
    if (stat.group !== "kickReturns" && stat.group !== "puntReturns") continue;
    const tds = num(stat.stats.TD);
    if (!tds) continue;
    out.set(stat.team, (out.get(stat.team) ?? 0) + tds);
  }

  return out;
}

/** Fumbles each side lost, which is what the other side's defence recovered. */
export function readFumblesLost(stats: PlayerStat[]): Map<string, number> {
  const out = new Map<string, number>();

  for (const stat of stats) {
    if (stat.group !== "fumbles") continue;
    const lost = num(stat.stats.LOST);
    if (!lost) continue;
    out.set(stat.team, (out.get(stat.team) ?? 0) + lost);
  }

  return out;
}

/** One side of a game, as far as scoring a defence is concerned. */
export interface GameSide {
  abbrev: string;
  /** Points this side put on the board — what the *other* defence allowed. */
  score: number;
}

/**
 * Everything in one game, scored: the players in it and both team defenses.
 *
 * This is the single entry point the ingestion and the live reader share, so
 * a score shown during a game and the score written down afterwards come out
 * of the same arithmetic rather than two implementations of it.
 */
export function scoreGameDetail(
  detail: GameDetail,
  sides: [GameSide, GameSide],
  format: ScoringFormat,
  rostered?: Set<string> | NameIndex,
): GameScores {
  const fieldGoals = readFieldGoals(detail.plays);
  const conversions = readTwoPointConversions(detail.plays);
  const safeties = readSafeties(detail.plays);
  const returnTds = readReturnTouchdowns(detail.stats);
  const fumblesLost = readFumblesLost(detail.stats);

  const players = scoreGame(detail.stats, format, rostered, {
    fieldGoals,
    twoPointers: conversions.scorers,
  });

  const defenses = new Map<string, DefenseScore>();
  for (const [side, other] of [
    [sides[0], sides[1]],
    [sides[1], sides[0]],
  ] as const) {
    if (!side.abbrev) continue;
    defenses.set(
      side.abbrev,
      scoreDefense(detail.stats, side.abbrev, other.score, {
        fumblesRecovered: fumblesLost.get(other.abbrev) ?? 0,
        safeties: safeties.get(side.abbrev) ?? 0,
        returnTouchdowns: returnTds.get(side.abbrev) ?? 0,
      }),
    );
  }

  const unattributed = conversions.unattributed
    ? [`${conversions.unattributed} two-point conversion(s) could not be attributed`]
    : [];

  return { players, defenses, unattributed };
}
