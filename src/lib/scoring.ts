import type { GameDetail, PlayerStat, ScoringPlay } from "./espn";
import { NameIndex, normalizeName } from "./player-names";

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
 * One line of arithmetic: a statistic, the rule applied to it, and what that
 * came to.
 *
 * This exists so a score can be checked rather than believed. "18.4" tells a
 * manager nothing about whether the app read the box score correctly;
 * "90 rec yds ÷ 10 = 9.0" can be held up against ESPN's own page and settled
 * in a second.
 */
export interface ScoreTerm {
  /** What was counted: "300 pass yds". */
  stat: string;
  /** How it converts: "÷ 25", "× 4". */
  rule: string;
  points: number;
}

/** Drops the terms worth nothing, which are noise in a breakdown. */
function terms(...list: ScoreTerm[]): ScoreTerm[] {
  return list.filter((t) => t.points !== 0);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Every rule that fired for one stat group, and what each was worth.
 *
 * This is the primitive: `scoreGroup` is its sum. Deliberately, so the
 * breakdown shown on a page cannot drift away from the number written into
 * the league — there is only one implementation to be wrong.
 *
 * ESPN's labels are the column headers of its own box score, so an
 * unrecognised group scores nothing rather than guessing.
 *
 * `distances` is optional and only read for the kicking group.
 */
export function explainGroup(
  stat: PlayerStat,
  format: ScoringFormat,
  distances?: number[],
): ScoreTerm[] {
  const s = stat.stats;

  switch (stat.group) {
    case "passing":
      return terms(
        { stat: `${num(s.YDS)} pass yds`, rule: `÷ ${RULES.passYardsPer}`,
          points: num(s.YDS) / RULES.passYardsPer },
        { stat: plural(num(s.TD), "pass TD"), rule: `× ${RULES.passTd}`,
          points: num(s.TD) * RULES.passTd },
        { stat: plural(num(s.INT), "interception"), rule: `× ${RULES.interception}`,
          points: num(s.INT) * RULES.interception },
      );

    case "rushing":
      return terms(
        { stat: `${num(s.YDS)} rush yds`, rule: `÷ ${RULES.rushRecYardsPer}`,
          points: num(s.YDS) / RULES.rushRecYardsPer },
        { stat: plural(num(s.TD), "rush TD"), rule: `× ${RULES.rushRecTd}`,
          points: num(s.TD) * RULES.rushRecTd },
      );

    case "receiving":
      return terms(
        { stat: `${num(s.YDS)} rec yds`, rule: `÷ ${RULES.rushRecYardsPer}`,
          points: num(s.YDS) / RULES.rushRecYardsPer },
        { stat: plural(num(s.TD), "rec TD"), rule: `× ${RULES.rushRecTd}`,
          points: num(s.TD) * RULES.rushRecTd },
        { stat: plural(num(s.REC), "catch", "catches"), rule: `× ${PPR[format]}`,
          points: num(s.REC) * PPR[format] },
      );

    case "fumbles":
      return terms({
        stat: plural(num(s.LOST), "fumble lost"),
        rule: `× ${RULES.fumbleLost}`,
        points: num(s.LOST) * RULES.fumbleLost,
      });

    case "kicking": {
      const [fgMade, fgAtt] = made(s.FG);
      const [xpMade, xpAtt] = made(s.XP);
      const misses = Math.max(0, fgAtt - fgMade);
      const kicks: ScoreTerm[] = [];

      // Kick by kick when the summary accounted for all of them, which is the
      // only way two fifty-yarders score as two.
      if ((distances?.length ?? 0) === fgMade && fgMade > 0) {
        for (const yards of distances!) {
          kicks.push({
            stat: `${yards} yd FG`,
            rule: yards >= 50 ? "50+" : "under 50",
            points: yards >= 50 ? RULES.fg50Plus : RULES.fgUnder50,
          });
        }
      } else if (fgMade > 0) {
        kicks.push({
          stat: plural(fgMade, "FG"),
          rule: `× ${RULES.fgUnder50}`,
          points: fgMade * RULES.fgUnder50,
        });
        if (num(s.LONG) >= 50) {
          kicks.push({
            stat: `longest ${num(s.LONG)}`,
            rule: "50+ bonus",
            points: RULES.fg50Plus - RULES.fgUnder50,
          });
        }
      }

      return terms(
        ...kicks,
        { stat: plural(misses, "missed FG"), rule: `× ${RULES.fgMissed}`,
          points: misses * RULES.fgMissed },
        { stat: plural(xpMade, "XP"), rule: `× ${RULES.xp}`, points: xpMade * RULES.xp },
        { stat: plural(Math.max(0, xpAtt - xpMade), "missed XP"), rule: `× ${RULES.xpMissed}`,
          points: Math.max(0, xpAtt - xpMade) * RULES.xpMissed },
      );
    }

    default:
      // Return yardage included: a punt returned for a touchdown is the
      // defence's score, not the returner's, and it is counted there.
      return [];
  }
}

/** What one stat group was worth. The sum of its own explanation. */
export function scoreGroup(
  stat: PlayerStat,
  format: ScoringFormat,
  distances?: number[],
): number {
  return explainGroup(stat, format, distances).reduce((sum, t) => sum + t.points, 0);
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
  /** The arithmetic, line by line, so a unit's score can be checked too. */
  terms: ScoreTerm[];
  /** The unit's afternoon, for the row it is shown in. */
  line: StatLine;
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
  /** Kickoff returns taken back for a touchdown. */
  kickReturnTouchdowns?: number;
  /** Punt returns taken back for a touchdown. */
  puntReturnTouchdowns?: number;
  /**
   * Total yards the opposing offence gained. Shown, not scored — this league
   * bands a defence on points allowed — but it is the number that says whether
   * a low score was a defensive performance or a quiet opponent.
   */
  yardsAllowed?: number;
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
  const kickReturnTd = extras.kickReturnTouchdowns ?? 0;
  const puntReturnTd = extras.puntReturnTouchdowns ?? 0;
  const defensiveTd = touchdowns;
  touchdowns += kickReturnTd + puntReturnTd;

  const band = POINTS_ALLOWED.find(([max]) => pointsAllowed <= max);
  const allowedPoints = band ? band[1] : 0;

  // The points-allowed band is always shown, even at zero, because it is the
  // largest term in most defensive scores and its absence would read as an
  // oversight rather than as a nil.
  const breakdown: ScoreTerm[] = [
    ...terms(
      { stat: plural(sacks, "sack"), rule: `× ${DEFENSE_RULES.sack}`,
        points: sacks * DEFENSE_RULES.sack },
      { stat: plural(interceptions, "interception"), rule: `× ${DEFENSE_RULES.interception}`,
        points: interceptions * DEFENSE_RULES.interception },
      { stat: plural(fumbleRecoveries, "fumble recovered"), rule: `× ${DEFENSE_RULES.fumbleRecovery}`,
        points: fumbleRecoveries * DEFENSE_RULES.fumbleRecovery },
      { stat: plural(safeties, "safety", "safeties"), rule: `× ${DEFENSE_RULES.safety}`,
        points: safeties * DEFENSE_RULES.safety },
      { stat: plural(touchdowns, "TD"), rule: `× ${DEFENSE_RULES.touchdown}`,
        points: touchdowns * DEFENSE_RULES.touchdown },
    ),
    { stat: `${pointsAllowed} allowed`, rule: bandLabel(pointsAllowed), points: allowedPoints },
  ];

  const points = breakdown.reduce((sum, t) => sum + t.points, 0);
  const safetyNote = safeties ? ` · ${safeties} SFTY` : "";

  const line: StatLine = {
    sacks,
    takeaways: interceptions,
    fumblesRecovered: fumbleRecoveries,
    pointsAllowed,
    yardsAllowed: extras.yardsAllowed,
    kickReturnTd,
    puntReturnTd,
    defTd: defensiveTd,
    safeties,
  };

  return {
    points: Math.round(points * 100) / 100,
    statLine:
      `${sacks} sacks · ${interceptions} INT · ${fumbleRecoveries} FR${safetyNote}` +
      ` · ${touchdowns} TD · ${pointsAllowed} allowed`,
    terms: breakdown,
    line,
  };
}

/** "14-20" — which band of points allowed a score fell into. */
function bandLabel(pointsAllowed: number): string {
  let low = 0;
  for (const [max] of POINTS_ALLOWED) {
    if (pointsAllowed <= max) return max === Infinity ? `${low}+` : low === max ? `${max}` : `${low}-${max}`;
    low = max + 1;
  }
  return "";
}

export interface ScoredPlayer {
  name: string;
  team: string;
  points: number;
  /**
   * A readable line, written without knowing the position. Kept as a fallback
   * for anything holding a score from before `line` existed; where the
   * position is known, format `line` instead.
   */
  statLine: string;
  /** The numbers themselves, for a caller that knows what position he plays. */
  line: StatLine;
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
  // The raw groups behind each row, so the stat line is read from all of them
  // at once rather than assembled a fragment at a time.
  const groupsOf = new Map<string, PlayerStat[]>();

  for (const stat of stats) {
    // The league's spelling wins, so every table stays keyed by one name.
    const name = index ? index.lookup(stat.name) : stat.name;
    if (!name) continue;

    const points = scoreGroup(stat, format, extras?.fieldGoals?.get(stat.name));
    const summary = summarize(stat);
    const existing = byPlayer.get(name);

    groupsOf.set(name, [...(groupsOf.get(name) ?? []), stat]);

    if (existing) {
      existing.points += points;
      if (summary) {
        existing.statLine = existing.statLine ? `${existing.statLine} · ${summary}` : summary;
      }
    } else {
      byPlayer.set(name, { name, team: stat.team, points, statLine: summary, line: {} });
    }
  }

  for (const [name, row] of byPlayer) {
    const groups = groupsOf.get(name) ?? [];
    row.line = readStatLine(groups);
    // Translated on the way in, so everything downstream reads one vocabulary.
    const stated = groups.find((g) => g.position)?.position;
    if (stated) row.line.position = toSlotPosition(stated);
  }

  // Conversions land on players who already have a line from the box score;
  // a two-point conversion is always somebody's carry or catch.
  //
  // The name comes from the scoring summary and the row from the box score,
  // and ESPN does not always spell them the same way, so with no roster index
  // to go through the rows are matched on their own normalised keys instead.
  const byKey = index
    ? null
    : new Map([...byPlayer.keys()].map((n) => [normalizeName(n), n]));

  for (const [espnName, count] of extras?.twoPointers ?? []) {
    const name = index ? index.lookup(espnName) : byKey!.get(normalizeName(espnName));
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
// The stat line
//
// What a manager wants beside the number, which is not the same thing as what
// the number was made of. A quarterback's line and a receiver's line share
// almost no columns, and a zero is worth showing in some of them and worth
// hiding in the rest — "0 rush TD" beside every quarterback in the league is
// noise that makes the ones who did run for a score harder to spot.
// ---------------------------------------------------------------------------

/**
 * A player's afternoon, in numbers, kept structured rather than as a
 * pre-written sentence.
 *
 * Structured because the position decides the wording, and the position is
 * better known where the line is *shown* — the roster knows a man is a tight
 * end even when he never entered our draft pool and ESPN forgot to say.
 */
export interface StatLine {
  /**
   * What ESPN says he plays, when it said.
   *
   * The roster knows the position of everybody it holds, so this is only ever
   * consulted for somebody it does not — a waiver pickup from outside the
   * draft pool, whose line would otherwise be formatted by guesswork.
   */
  position?: string;

  // Passing
  completions?: number;
  attempts?: number;
  passYards?: number;
  passTd?: number;
  intsThrown?: number;

  // Rushing
  carries?: number;
  rushYards?: number;
  rushTd?: number;

  // Receiving
  targets?: number;
  receptions?: number;
  recYards?: number;
  recTd?: number;

  fumblesLost?: number;

  // Kicking
  fgMade?: number;
  fgAttempted?: number;
  xpMade?: number;
  xpAttempted?: number;

  // A unit rather than a man
  sacks?: number;
  takeaways?: number;
  fumblesRecovered?: number;
  pointsAllowed?: number;
  yardsAllowed?: number;
  kickReturnTd?: number;
  puntReturnTd?: number;
  defTd?: number;
  safeties?: number;
}

/** Everything a player did, gathered off whichever groups he appeared in. */
export function readStatLine(stats: PlayerStat[]): StatLine {
  const line: StatLine = {};

  for (const stat of stats) {
    const s = stat.stats;

    switch (stat.group) {
      case "passing": {
        const [comp, att] = made(s["C/ATT"]);
        line.completions = (line.completions ?? 0) + comp;
        line.attempts = (line.attempts ?? 0) + att;
        line.passYards = (line.passYards ?? 0) + num(s.YDS);
        line.passTd = (line.passTd ?? 0) + num(s.TD);
        line.intsThrown = (line.intsThrown ?? 0) + num(s.INT);
        break;
      }
      case "rushing":
        line.carries = (line.carries ?? 0) + num(s.CAR);
        line.rushYards = (line.rushYards ?? 0) + num(s.YDS);
        line.rushTd = (line.rushTd ?? 0) + num(s.TD);
        break;
      case "receiving":
        // ESPN labels targets TGTS on some responses and TAR on others, and
        // omits the column altogether on a few. Receptions are the floor: a
        // man cannot have been thrown at fewer times than he caught.
        line.receptions = (line.receptions ?? 0) + num(s.REC);
        line.targets =
          (line.targets ?? 0) + Math.max(num(s.TGTS) || num(s.TAR), num(s.REC));
        line.recYards = (line.recYards ?? 0) + num(s.YDS);
        line.recTd = (line.recTd ?? 0) + num(s.TD);
        break;
      case "fumbles":
        line.fumblesLost = (line.fumblesLost ?? 0) + num(s.LOST);
        break;
      case "kicking": {
        const [fgMade, fgAtt] = made(s.FG);
        const [xpMade, xpAtt] = made(s.XP);
        line.fgMade = (line.fgMade ?? 0) + fgMade;
        line.fgAttempted = (line.fgAttempted ?? 0) + fgAtt;
        line.xpMade = (line.xpMade ?? 0) + xpMade;
        line.xpAttempted = (line.xpAttempted ?? 0) + xpAtt;
        break;
      }
    }
  }

  return line;
}

/**
 * Several weeks of a player's afternoons, added into one season.
 *
 * Every field on a StatLine is a count of something that happened, so a season
 * is the sum of its weeks — with two exceptions that are not counts at all:
 * `position` is a fact about the man rather than about a week, and it is
 * carried through from whichever week stated it.
 *
 * Points allowed and yards allowed do add up: a defence's season total is what
 * it gave up across the year, which is the number worth showing.
 */
export function sumStatLines(lines: StatLine[]): StatLine {
  const total: StatLine = {};

  for (const line of lines) {
    for (const [key, value] of Object.entries(line)) {
      if (key === "position") {
        if (!total.position && typeof value === "string") total.position = value;
        continue;
      }
      if (typeof value !== "number") continue;
      const field = key as keyof StatLine;
      (total[field] as number) = ((total[field] as number | undefined) ?? 0) + value;
    }
  }

  return total;
}

/** A number, without a trailing ".0" on the half-sacks that do not need one. */
function tidy(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/**
 * ESPN's word for a position, in the league's.
 *
 * ESPN writes a kicker as PK, a fullback as FB and a back as HB. A lineup slot
 * is called K, RB and RB. The two vocabularies used not to meet often, because
 * ESPN's answer was only consulted for a player the draft pool had never heard
 * of and a box score rarely stated one anyway.
 *
 * Reading the club team sheet changed that: nearly every player now arrives
 * with ESPN's own word for what he plays, and formatStatLine switches on the
 * league's. Untranslated, a kicker off the waiver wire came out with a blank
 * stat line — "PK" matches no case — which is a silent wrong answer of exactly
 * the kind this whole change exists to remove.
 *
 * Anything unrecognised passes through unchanged. A DT is a DT; the league has
 * no slot for one and nothing downstream pretends otherwise.
 */
const SLOT_POSITIONS: Record<string, string> = {
  PK: "K",
  FB: "RB",
  HB: "RB",
  DEF: "D/ST",
  DST: "D/ST",
};

export function toSlotPosition(espn: string | null | undefined): string {
  const upper = (espn ?? "").trim().toUpperCase();
  return SLOT_POSITIONS[upper] ?? upper;
}

/**
 * The line as it is shown beside a score, in the vocabulary of the position.
 *
 * Two rules, applied throughout. What the position is *for* always shows, even
 * at nought — a running back who was given the ball twice and went nowhere
 * should say so, and a blank looks like missing data rather than a bad
 * afternoon. Everything else, touchdowns included, shows only when it happened.
 */
export function formatStatLine(line: StatLine | null | undefined, position: string): string {
  if (!line || Object.keys(line).length === 0) return "";

  const parts: string[] = [];

  /**
   * `always` means the column belongs to this position and is shown even at
   * nought — including when the group is missing from the box score entirely,
   * which is how a back who never ran a route is reported. That absence is
   * itself the fact worth showing: nought receiving yards is a bad afternoon,
   * and a gap where the number should be looks like a bug.
   */
  const push = (value: number | undefined, render: (n: number) => string, always = false) => {
    if (value == null && !always) return;
    const n = value ?? 0;
    if (!always && n === 0) return;
    parts.push(render(n));
  };

  switch (position) {
    case "QB":
      if (line.attempts != null) parts.push(`${line.completions ?? 0}/${line.attempts}`);
      push(line.passYards, (n) => `${n} pass yds`, true);
      push(line.rushYards, (n) => `${n} rush yds`);
      push(line.passTd, (n) => `${n} pass TD`);
      push(line.rushTd, (n) => `${n} rush TD`);
      break;

    case "RB":
      push(line.carries, (n) => `${n} car`, true);
      push(line.rushYards, (n) => `${n} rush yds`, true);
      push(line.recYards, (n) => `${n} rec yds`, true);
      push(line.rushTd, (n) => `${n} rush TD`);
      push(line.recTd, (n) => `${n} rec TD`);
      break;

    case "WR":
    case "TE":
      push(line.targets, (n) => `${n} tgt`, true);
      push(line.receptions, (n) => `${n} rec`, true);
      push(line.recYards, (n) => `${n} rec yds`, true);
      push(line.recTd, (n) => `${n} rec TD`);
      break;

    case "K":
      if (line.fgAttempted != null) parts.push(`${line.fgMade ?? 0}/${line.fgAttempted} FG`);
      if (line.xpAttempted != null) parts.push(`${line.xpMade ?? 0}/${line.xpAttempted} XP`);
      break;

    case "D/ST":
      push(line.sacks, (n) => `${tidy(n)} sack`, true);
      push(line.fumblesRecovered, (n) => `${n} FR`, true);
      push(line.takeaways, (n) => `${n} INT`, true);
      push(line.yardsAllowed, (n) => `${n} yds allowed`, true);
      push(line.kickReturnTd, (n) => `${n} KORTD`);
      push(line.puntReturnTd, (n) => `${n} PRTD`);
      break;

    default: {
      // An unknown position still deserves a line rather than a blank, so it
      // gets whatever he actually did.
      push(line.passYards, (n) => `${n} pass yds`);
      push(line.carries, (n) => `${n} car`);
      push(line.rushYards, (n) => `${n} rush yds`);
      push(line.receptions, (n) => `${n} rec`);
      push(line.recYards, (n) => `${n} rec yds`);
      push(line.passTd, (n) => `${n} pass TD`);
      push(line.rushTd, (n) => `${n} rush TD`);
      push(line.recTd, (n) => `${n} rec TD`);
    }
  }

  // Turnovers are worth saying whoever he is, because they are the only lines
  // that took points off him.
  if (position !== "D/ST") {
    push(line.fumblesLost, (n) => `${n} fum lost`);
    push(line.intsThrown, (n) => `${n} INT`);
  }

  return parts.join(" · ");
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

export interface ReturnTouchdowns {
  /** Kickoff returns taken back, by team. */
  kick: Map<string, number>;
  /** Punt returns taken back, by team. */
  punt: Map<string, number>;
}

/**
 * Returns taken to the house, kept apart by kind.
 *
 * They score the same — six to the unit either way — but a stat line that says
 * KORTD when it was a punt is wrong in the way that makes somebody stop
 * trusting the rest of it.
 */
export function readReturnTouchdowns(stats: PlayerStat[]): ReturnTouchdowns {
  const kick = new Map<string, number>();
  const punt = new Map<string, number>();

  for (const stat of stats) {
    const into =
      stat.group === "kickReturns" ? kick : stat.group === "puntReturns" ? punt : null;
    if (!into) continue;

    const tds = num(stat.stats.TD);
    if (!tds) continue;
    into.set(stat.team, (into.get(stat.team) ?? 0) + tds);
  }

  return { kick, punt };
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

/** ESPN's team-total row, reduced to the one number a defence is judged on. */
function totalYards(totals: Record<string, string> | undefined): number | undefined {
  if (!totals) return undefined;
  const raw = totals.totalYards;
  if (raw == null) return undefined;
  const yards = Number(String(raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(yards) ? yards : undefined;
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
  const returns = readReturnTouchdowns(detail.stats);
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
        kickReturnTouchdowns: returns.kick.get(side.abbrev) ?? 0,
        puntReturnTouchdowns: returns.punt.get(side.abbrev) ?? 0,
        // What the other side gained, which is what this defence gave up.
        yardsAllowed: totalYards(detail.teamTotals[other.abbrev]),
      }),
    );
  }

  const unattributed = conversions.unattributed
    ? [`${conversions.unattributed} two-point conversion(s) could not be attributed`]
    : [];

  return { players, defenses, unattributed };
}
