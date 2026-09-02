import { fetchGameDetail, fetchScoreboard, type Game, type PlayerStat } from "./espn";
import { normalizeName } from "./player-names";
import { player as pooledPlayer } from "./roster";
import {
  explainGroup,
  formatStatLine,
  readStatLine,
  readFieldGoals,
  readReturnTouchdowns,
  readSafeties,
  readTwoPointConversions,
  scoreDefense,
  type ScoreTerm,
  type ScoringFormat,
  type StatLine,
} from "./scoring";
import { slotsOf } from "@/data/league-sim";
import type { LeagueShape } from "./roster";

/**
 * The preseason, scored, as a way of checking the scoring before it counts.
 *
 * Every number the league will run on comes out of ESPN's box scores put
 * through the same arithmetic that scores a real Sunday. The only way to know
 * that arithmetic is right is to run it against a real game and check it by
 * hand — and the preseason is the one part of the year where being wrong
 * costs nothing.
 *
 * So this pulls a preseason week, scores everyone in it, and shows its
 * working: for each player, the raw columns ESPN published and the line of
 * arithmetic each one produced. Open the box score on ESPN, hold it up
 * against this, and any disagreement is visible rather than arguable.
 *
 * Nothing here writes anything. A preseason score must never reach
 * player_scores — starters play a series and backups play three quarters, so
 * the numbers are meaningless as fantasy results even though they are exactly
 * right as a test of the parser.
 */

/** ESPN's preseason: week 1 is the Hall of Fame game, then three more. */
const PRESEASON_WEEKS = 4;

const FLEX_TAKES = ["RB", "WR", "TE"];

export interface PreseasonPlayer {
  name: string;
  team: string;
  position: string;
  /** Where the position came from, since ESPN does not always say. */
  positionSource: "espn" | "pool" | "inferred";
  /**
   * Passing attempts, carries and targets added together.
   *
   * A stand-in for snaps, which this endpoint does not carry. Named for what
   * it is rather than for what it approximates: in a preseason game the
   * players with the ball in their hands most are the ones who were on the
   * field longest, which is the property being selected for.
   */
  workload: number;
  points: number;
  /** The afternoon in words, in the vocabulary of the position. */
  statLine: string;
  /** And the numbers behind it. */
  line: StatLine;
  /** The arithmetic, line by line. */
  terms: ScoreTerm[];
  /** Exactly what ESPN published, group by group, with nothing dropped. */
  raw: { group: string; stats: Record<string, string> }[];
  gameId: string;
}

export interface PreseasonGame {
  id: string;
  label: string;
  state: string;
  detail: string;
}

export interface PreseasonWeek {
  week: number;
  /** Whether ESPN had anything for that week at all. */
  found: boolean;
  games: PreseasonGame[];
  players: PreseasonPlayer[];
  lineup: { slot: string; player: PreseasonPlayer | null }[];
  total: number;
  format: ScoringFormat;
  failed: string[];
  unattributed: string[];
  fetchedAt: string;
}

/** Attempts, carries and targets — the closest thing to snaps on offer. */
function workloadOf(stats: PlayerStat[]): number {
  let total = 0;
  for (const s of stats) {
    if (s.group === "passing") total += Number(s.stats["C/ATT"]?.split("/")[1] ?? 0) || 0;
    if (s.group === "rushing") total += Number(s.stats.CAR ?? 0) || 0;
    if (s.group === "receiving") {
      // Targets when ESPN gives them, catches when it does not: a receiver
      // thrown at eight times played more than one thrown at twice, whether
      // or not he held on.
      const targets = Number(s.stats.TGTS ?? 0) || 0;
      total += targets || Number(s.stats.REC ?? 0) || 0;
    }
    if (s.group === "kicking") {
      const [, fgAtt] = (s.stats.FG ?? "0/0").split("/");
      const [, xpAtt] = (s.stats.XP ?? "0/0").split("/");
      total += (Number(fgAtt) || 0) + (Number(xpAtt) || 0);
    }
  }
  return total;
}

/**
 * ESPN's position vocabulary, in the league's terms.
 *
 * It says PK for a kicker and the roster slot is K, which is the sort of
 * difference that silently leaves a slot unfilled and looks like "nobody
 * kicked this week". A fullback goes in as a back because that is the slot he
 * would occupy if anybody rostered one.
 */
const POSITION_ALIASES: Record<string, string> = {
  PK: "K",
  FB: "RB",
  HB: "RB",
  DEF: "D/ST",
  DST: "D/ST",
};

function asSlotPosition(espn: string): string {
  const upper = espn.toUpperCase();
  return POSITION_ALIASES[upper] ?? upper;
}

/**
 * What position a player is, from the best source that has an answer.
 *
 * ESPN first, because it is talking about this game. The league's own pool
 * second, for anyone it knows. And failing both, an inference from what he
 * did — which cannot tell a tight end from a receiver, and says so by
 * labelling itself.
 */
function positionOf(
  name: string,
  stats: PlayerStat[],
): { position: string; source: PreseasonPlayer["positionSource"] } {
  const stated = stats.find((s) => s.position)?.position;
  if (stated) return { position: asSlotPosition(stated), source: "espn" };

  const pooled = pooledPlayer(name);
  if (pooled) return { position: pooled.p, source: "pool" };

  // Reaching here means ESPN named neither the man on its team sheet nor in
  // its box score, and the league has never heard of him either — which is
  // rare enough that saying so on the row is more use than a quiet guess.
  const groups = new Set(stats.map((s) => s.group));
  if (groups.has("kicking")) return { position: "K", source: "inferred" };
  if (groups.has("passing")) return { position: "QB", source: "inferred" };
  if (groups.has("rushing") && !groups.has("receiving")) return { position: "RB", source: "inferred" };
  if (groups.has("receiving")) return { position: "WR", source: "inferred" };
  return { position: "", source: "inferred" };
}

/**
 * The most recent preseason week ESPN has results for, walking back from the
 * last one. In September that is week 4; in the middle of August it is
 * whichever has just been played.
 */
async function latestPlayedWeek(): Promise<{ week: number; games: Game[] }> {
  for (let week = PRESEASON_WEEKS; week >= 1; week--) {
    const games = await fetchScoreboard(week, 1);
    if (games.some((g) => g.state !== "pre")) return { week, games };
  }
  return { week: 0, games: [] };
}

/**
 * One preseason week, scored.
 *
 * `week` null asks for the most recent one that has been played, which costs
 * up to four scoreboard requests in the off-season and one during it.
 */
export async function preseasonWeek(
  week: number | null,
  format: ScoringFormat,
  league: LeagueShape | null,
): Promise<PreseasonWeek> {
  const found = week != null
    ? { week, games: await fetchScoreboard(week, 1) }
    : await latestPlayedWeek();

  const fetchedAt = new Date().toISOString();

  const empty: PreseasonWeek = {
    week: found.week,
    found: found.games.length > 0,
    games: [],
    players: [],
    lineup: [],
    total: 0,
    format,
    failed: [],
    unattributed: [],
    fetchedAt,
  };

  const played = found.games.filter((g) => g.state !== "pre");
  if (!played.length) return empty;

  const failed: string[] = [];
  const unattributed: string[] = [];

  const details = await Promise.all(
    played.map(async (game) => {
      try {
        return { game, detail: await fetchGameDetail(game.id) };
      } catch (err) {
        console.error(`[preseason] game ${game.id} failed`, err);
        failed.push(game.id);
        return null;
      }
    }),
  );

  const players: PreseasonPlayer[] = [];

  for (const entry of details) {
    if (!entry) continue;
    const { game, detail } = entry;

    const fieldGoals = readFieldGoals(detail.plays);
    const conversions = readTwoPointConversions(detail.plays);

    // The summary and the box score are two different people typing two
    // different spellings of the same man: the play said "Patrick Mahomes",
    // the box score says "Patrick Mahomes II". Matched on the normalised key,
    // the same way every other name in this app is matched.
    const conversionsByKey = new Map<string, number>();
    for (const [who, count] of conversions.scorers) {
      const key = normalizeName(who);
      conversionsByKey.set(key, (conversionsByKey.get(key) ?? 0) + count);
    }
    const safeties = readSafeties(detail.plays);
    const returns = readReturnTouchdowns(detail.stats);

    if (conversions.unattributed) {
      unattributed.push(
        `${game.id}: ${conversions.unattributed} two-point conversion(s) could not be attributed`,
      );
    }

    // Gathered per player across the groups he appears in, the same way the
    // real scorer does it: a back who also catches passes is one row, not two.
    // Scoped to this game, since a player is in exactly one of them a week.
    const byPlayer = new Map<string, PlayerStat[]>();
    for (const stat of detail.stats) {
      byPlayer.set(stat.name, [...(byPlayer.get(stat.name) ?? []), stat]);
    }

    for (const [name, held] of byPlayer) {
      const terms: ScoreTerm[] = [];
      for (const stat of held) {
        terms.push(...explainGroup(stat, format, fieldGoals.get(name)));
      }

      const conversionCount = conversionsByKey.get(normalizeName(name)) ?? 0;
      if (conversionCount) {
        terms.push({
          stat: `${conversionCount} two-point conversion`,
          rule: "× 2",
          points: conversionCount * 2,
        });
      }

      // A man who neither touched the ball nor scored is left off. A defensive
      // lineman with three tackles belongs to his unit's score, not to a row
      // of his own.
      const workload = workloadOf(held);
      if (!terms.length && workload === 0) continue;

      const { position, source } = positionOf(name, held);
      const line = readStatLine(held);

      players.push({
        name,
        team: held[0]?.team ?? "",
        position,
        positionSource: source,
        workload,
        points: Math.round(terms.reduce((sum, t) => sum + t.points, 0) * 100) / 100,
        statLine: formatStatLine(line, position),
        line,
        terms,
        raw: held.map((s) => ({ group: s.group, stats: s.stats })),
        gameId: game.id,
      });
    }

    // Both team defences, scored the same way a real week scores them.
    for (const [side, other] of [
      [game.home, game.away],
      [game.away, game.home],
    ] as const) {
      if (!side || !other) continue;

      const opponentLost = detail.stats
        .filter((s) => s.group === "fumbles" && s.team === other.abbrev)
        .reduce((sum, s) => sum + (Number(s.stats.LOST ?? 0) || 0), 0);

      const unit = scoreDefense(detail.stats, side.abbrev, other.score, {
        fumblesRecovered: opponentLost,
        safeties: safeties.get(side.abbrev) ?? 0,
        kickReturnTouchdowns: returns.kick.get(side.abbrev) ?? 0,
        puntReturnTouchdowns: returns.punt.get(side.abbrev) ?? 0,
        yardsAllowed: Number(
          String(detail.teamTotals[other.abbrev]?.totalYards ?? "").replace(/[^\d.-]/g, ""),
        ) || undefined,
      });

      players.push({
        name: `${side.name} D/ST`,
        team: side.abbrev,
        position: "D/ST",
        positionSource: "espn",
        // A defence is on the field for the whole game by definition, so
        // ranking it by workload would be meaningless. It is here to be
        // checked, not to be picked.
        workload: 0,
        points: unit.points,
        statLine: formatStatLine(unit.line, "D/ST"),
        line: unit.line,
        terms: unit.terms,
        raw: [],
        gameId: game.id,
      });
    }
  }

  // The heaviest workloads first, which is the question the page is asking:
  // who was actually on the field long enough for their line to mean anything.
  players.sort((a, b) => b.workload - a.workload || b.points - a.points);

  const lineup = mockLineup(players, league);
  const total =
    Math.round(lineup.reduce((sum, r) => sum + (r.player?.points ?? 0), 0) * 100) / 100;

  return {
    week: found.week,
    found: true,
    games: played.map((g) => ({
      id: g.id,
      label: `${g.away?.abbrev ?? "?"} ${g.away?.score ?? 0} @ ${g.home?.abbrev ?? "?"} ${g.home?.score ?? 0}`,
      state: g.state,
      detail: g.statusDetail,
    })),
    players,
    lineup,
    total,
    format,
    failed,
    unattributed,
    fetchedAt,
  };
}

/**
 * A starting eleven built out of the preseason's busiest players, in the
 * league's own slot order.
 *
 * Busiest rather than highest-scoring, deliberately. A third-string receiver
 * who caught one long touchdown outscores everyone and tells you nothing; a
 * back who carried it eighteen times has a stat line with enough in it to be
 * worth checking, which is the entire purpose of the page.
 */
function mockLineup(
  players: PreseasonPlayer[],
  league: LeagueShape | null,
): { slot: string; player: PreseasonPlayer | null }[] {
  const used = new Set<string>();

  return slotsOf(league ?? undefined).map((slot: string) => {
    const accepts = slot === "FLEX" ? FLEX_TAKES : [slot];

    const pick = players.find(
      (p) => !used.has(p.name) && accepts.includes(p.position) && (p.workload > 0 || slot === "D/ST"),
    );

    if (!pick) return { slot, player: null };
    used.add(pick.name);
    return { slot, player: pick };
  });
}
