import type { PlayerStat } from "./espn";

export type ScoringFormat = "standard" | "half" | "ppr";

/** Points per reception, from the league's own `scoring` setting. */
const PPR: Record<ScoringFormat, number> = { standard: 0, half: 0.5, ppr: 1 };

const RULES = {
  passYardsPer: 25,
  passTd: 4,
  interception: -2,
  rushRecYardsPer: 10,
  rushRecTd: 6,
  fumbleLost: -2,
  twoPoint: 2,
  xp: 1,
  fgUnder50: 3,
  fg50Plus: 5,
  fgMissed: -1,
};

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
 * Fantasy points for one stat group. ESPN's labels are the column headers of
 * its own box score, so an unrecognised group scores zero rather than guessing.
 */
export function scoreGroup(stat: PlayerStat, format: ScoringFormat): number {
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
      // ESPN gives FG as made/attempted and does not break out distance per
      // kick, so the long-field-goal bonus can only be applied to one kick.
      const [fgMade, fgAtt] = made(s.FG);
      const [xpMade] = made(s.XP);
      const long = num(s.LONG);
      const bonus = long >= 50 ? RULES.fg50Plus - RULES.fgUnder50 : 0;
      return (
        fgMade * RULES.fgUnder50 +
        bonus +
        xpMade * RULES.xp +
        (fgAtt - fgMade) * RULES.fgMissed
      );
    }

    default:
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

/**
 * A team defense, scored from its players' box-score lines plus the points its
 * opponent put up. ESPN has no D/ST row — it reports defenders individually —
 * so the unit is assembled here from every defender on that team.
 */
export function scoreDefense(
  stats: PlayerStat[],
  teamAbbrev: string,
  pointsAllowed: number,
): DefenseScore {
  let sacks = 0;
  let interceptions = 0;
  let fumbleRecoveries = 0;
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
      // A recovery by the defence; the offensive "LOST" case is scored against
      // the player who fumbled, in scoreGroup.
      fumbleRecoveries += num(s.REC);
    }
  }

  const band = POINTS_ALLOWED.find(([max]) => pointsAllowed <= max);
  const allowedPoints = band ? band[1] : 0;

  const points =
    sacks * DEFENSE_RULES.sack +
    interceptions * DEFENSE_RULES.interception +
    fumbleRecoveries * DEFENSE_RULES.fumbleRecovery +
    touchdowns * DEFENSE_RULES.touchdown +
    allowedPoints;

  return {
    points: Math.round(points * 100) / 100,
    statLine: `${sacks} sacks · ${interceptions} INT · ${fumbleRecoveries} FR · ${touchdowns} TD · ${pointsAllowed} allowed`,
  };
}

export interface ScoredPlayer {
  name: string;
  team: string;
  points: number;
  statLine: string;
}

/**
 * Rolls every stat group for a player into one score. A player appears in
 * several groups in one game (a running back who also catches passes), so the
 * groups are summed per name.
 */
export function scoreGame(
  stats: PlayerStat[],
  format: ScoringFormat,
  rostered?: Set<string>,
): ScoredPlayer[] {
  const byPlayer = new Map<string, ScoredPlayer>();

  for (const stat of stats) {
    if (rostered && !rostered.has(stat.name)) continue;

    const points = scoreGroup(stat, format);
    const line = summarize(stat);
    const existing = byPlayer.get(stat.name);

    if (existing) {
      existing.points += points;
      if (line) existing.statLine = existing.statLine ? `${existing.statLine} · ${line}` : line;
    } else {
      byPlayer.set(stat.name, {
        name: stat.name,
        team: stat.team,
        points,
        statLine: line,
      });
    }
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
