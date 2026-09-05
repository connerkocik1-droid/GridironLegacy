import { NameIndex, isDefense, normalizeName } from "@/lib/player-names";
import {
  formatStatLine,
  scoreGame,
  toSlotPosition,
  type ScoringFormat,
  type ScoredPlayer,
} from "@/lib/scoring";
import type { Play, PlayerStat, ScoringPlay } from "@/lib/espn";

/**
 * One real football game, told the way a fantasy manager reads it.
 *
 * A scoreboard says 21–17. It does not say that four of the twenty-two people
 * you care about are on that field, that two of them are yours and one belongs
 * to the manager you are playing this week, or that the touchdown thirty
 * seconds ago moved your afternoon by six points. Every other platform makes
 * you hold your roster in your head while you watch — this holds it for you.
 *
 * The shaping lives here, apart from the route, because it is the half that
 * can be tested. ESPN cannot be reached from the machine this was written on,
 * so the parsing above it is exercised against recorded payloads and the
 * arithmetic below it against made-up ones; what nobody here can do is prove
 * that ESPN still answers the way it did when the fixtures were recorded.
 */

export interface OwnedPlayer {
  /** The league's spelling where it is owned, ESPN's where it is not. */
  name: string;
  team: string;
  /** A slot position — QB, RB, WR, TE, K, D/ST — or "" if nobody knows. */
  position: string;
  points: number;
  /** "6 car, 42 yds, 1 TD", in the vocabulary of the position. */
  statLine: string;
  /** The franchise holding him, or null for a free agent. */
  franchise: string | null;
  /** So the browser can mark its own without the server knowing who is asking. */
  managerId: string | null;
}

export interface GamecastPlay {
  id: string;
  period: number;
  clock: string;
  text: string;
  scoring: boolean;
  homeScore: number;
  awayScore: number;
}

export interface Gamecast {
  /** Everybody in this game who is on somebody's roster, best first. */
  owned: OwnedPlayer[];
  /** The best afternoons in the game whoever owns them, best first. */
  notable: OwnedPlayer[];
  scoring: ScoringPlay[];
  plays: GamecastPlay[];
}

/** Who holds whom, by the league's own spelling. */
export interface Ownership {
  /** Player name as the league spells it, to the franchise holding him. */
  byPlayer: Map<string, { franchise: string; managerId: string }>;
}

/** How many of the most recent plays to carry. A quarter is about forty. */
const PLAY_WINDOW = 60;

/** How many unowned performances are worth naming. */
const NOTABLE = 6;

function positionOf(stats: PlayerStat[], name: string): string {
  const key = normalizeName(name);
  for (const stat of stats) {
    if (normalizeName(stat.name) === key && stat.position) return toSlotPosition(stat.position);
  }
  return "";
}

/**
 * Turns one game's box score into the two lists a manager actually wants: the
 * players somebody in this league owns, and the players tearing the game up
 * whether or not anybody owns them.
 *
 * Scored once, for everybody, rather than once per roster. `scoreGame` given a
 * name index returns only the players in it, which would mean a second pass to
 * find out who else is having a big day — and the second pass would score the
 * same numbers again.
 */
export function gamecast(
  stats: PlayerStat[],
  scoring: ScoringPlay[],
  plays: Play[],
  owners: Ownership,
  format: ScoringFormat,
): Gamecast {
  const index = new NameIndex(owners.byPlayer.keys());
  const scored: ScoredPlayer[] = scoreGame(stats, format);

  const rows: OwnedPlayer[] = scored.map((p) => {
    // ESPN's spelling in, the league's spelling out — so a name shown here
    // matches the one on the roster page rather than being a second opinion
    // about how somebody spells their surname.
    const leagueName = index.lookup(p.name);
    const held = leagueName ? (owners.byPlayer.get(leagueName) ?? null) : null;

    return {
      name: leagueName ?? p.name,
      team: p.team,
      position: positionOf(stats, p.name),
      points: p.points,
      statLine: formatStatLine(p.line, positionOf(stats, p.name)) || p.statLine,
      franchise: held?.franchise ?? null,
      managerId: held?.managerId ?? null,
    };
  });

  const byPoints = (a: OwnedPlayer, b: OwnedPlayer) => b.points - a.points;

  const owned = rows.filter((r) => r.franchise != null).sort(byPoints);
  const notable = rows
    .filter((r) => r.franchise == null && r.points > 0)
    .sort(byPoints)
    .slice(0, NOTABLE);

  return {
    owned,
    notable,
    scoring,
    // Newest first, because a manager opening this mid-game wants the last
    // thing that happened and not the opening kickoff. Trimmed, because a
    // finished game is about a hundred and sixty plays and nobody scrolls to
    // the bottom of one on a phone.
    plays: plays
      .slice(-PLAY_WINDOW)
      .reverse()
      .map((p) => ({
        id: p.id,
        period: p.period,
        clock: p.clock,
        text: p.text,
        scoring: p.scoring,
        homeScore: p.homeScore,
        awayScore: p.awayScore,
      })),
  };
}

/**
 * A defence is owned by team, not by name.
 *
 * "Chicago Bears D/ST" never appears in a box score — the unit's numbers are
 * in the team totals, and the roster holds a name ESPN has never heard of. So
 * ownership of a unit is matched on the club rather than through the name
 * index, which deliberately refuses to hold defences at all.
 */
export function defenceOwners(
  owners: Ownership,
  abbrevOf: (rosterName: string) => string | null,
): Map<string, { franchise: string; managerId: string }> {
  const out = new Map<string, { franchise: string; managerId: string }>();

  for (const [name, held] of owners.byPlayer) {
    if (!isDefense(name)) continue;
    const abbrev = abbrevOf(name);
    if (abbrev) out.set(abbrev, held);
  }

  return out;
}
