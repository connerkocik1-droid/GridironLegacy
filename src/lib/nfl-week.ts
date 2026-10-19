/**
 * What each NFL team is doing this week, so a lineup can say so.
 *
 * A fantasy lineup is twelve men in twelve different stadiums, and the two
 * questions a manager has about any of them on a Sunday are the same two:
 * has he played, and if not, when. Without that a row of zeroes is unreadable
 * — a nought beside a man who has finished is a disaster, and the identical
 * nought beside a man kicking off at four is nothing at all.
 *
 * The league already stores the week's fixtures for the pick-'em, kickoff
 * times and all, so none of this is fetched or guessed. It is only turned
 * round: the table is keyed by game, and a lineup needs it keyed by team.
 */

export type GameState = "pre" | "in" | "post";

export interface NflGameRow {
  home_team: string;
  away_team: string;
  starts_at: string;
  state: string;
  /**
   * The quarter under way (5 and up for overtime) and the seconds left in it,
   * mirrored off the scoreboard while a game is being played. Both columns
   * arrive with migration 0062; a row read from a database without them, or
   * written before they were kept, simply lacks them.
   */
  period?: number | null;
  clock?: number | null;
}

export interface TeamGame {
  state: GameState;
  /** The other team. */
  opponent: string;
  /** True when this team is away, which is what the "@" in "@LV" means. */
  away: boolean;
  /** ISO, formatted on the client so it lands in the reader's own timezone. */
  startsAt: string;
  /**
   * How much of the game is still to be played, 0 to 1: all of it before
   * kickoff, none of it after the whistle, and in between whatever the clock
   * says. See gameLeft.
   */
  left: number;
}

/** A quarter, on the game clock. */
export const QUARTER_SECONDS = 15 * 60;

/**
 * How long a game takes on a real clock, kickoff to final whistle — halftime,
 * commercials and all. The estimate of last resort, used only when there is no
 * game clock to read.
 */
export const GAME_MINUTES = 190;

/**
 * The least a game in progress is ever said to have left. It is not over until
 * the whistle — a quarter that has run down can still go to overtime, and an
 * estimate from the wall clock runs long for a game that does — and a model
 * told there is nothing left would call it on the spot.
 */
export const IN_PLAY_FLOOR = 0.02;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * The share of a game still to be played, 0 to 1.
 *
 * The game clock when the mirror has it: whole quarters to come plus what is
 * left of this one. Overtime counts only the time left in the extra period,
 * which is a sliver of a game and should read as one.
 *
 * Without the clock — a database that has not run 0062, or a row written
 * before the scoreboard's clock was kept — the time since kickoff against how
 * long a game takes. Coarser, and it drifts in a long game, but it moves the
 * right way: two hours in is not the same as kickoff, which is what the win
 * probability used to assume about anybody on the field.
 */
export function gameLeft(row: NflGameRow, now: number = Date.now()): number {
  if (row.state === "post") return 0;
  if (row.state !== "in") return 1;

  const period = Number(row.period);
  const clock = Number(row.clock);
  if (row.period != null && row.clock != null && Number.isFinite(period) && Number.isFinite(clock) && period >= 1) {
    const inQuarter = clamp(clock, 0, QUARTER_SECONDS);
    const toPlay = period <= 4 ? (4 - period) * QUARTER_SECONDS + inQuarter : inQuarter;
    return clamp(toPlay / (4 * QUARTER_SECONDS), IN_PLAY_FLOOR, 1);
  }

  const kickoff = new Date(row.starts_at).getTime();
  // In progress and nothing to say how far: the middle is the honest guess.
  if (!Number.isFinite(kickoff)) return 0.5;
  const minutes = (now - kickoff) / 60_000;
  return clamp(1 - minutes / GAME_MINUTES, IN_PLAY_FLOOR, 1);
}

/** The week's games, keyed by each team playing in them. */
export function teamGames(rows: NflGameRow[], now: number = Date.now()): Record<string, TeamGame> {
  const byTeam: Record<string, TeamGame> = {};
  for (const row of rows) {
    const state: GameState =
      row.state === "in" || row.state === "post" ? row.state : "pre";
    const left = gameLeft({ ...row, state }, now);
    byTeam[row.home_team] = { state, opponent: row.away_team, away: false, startsAt: row.starts_at, left };
    byTeam[row.away_team] = { state, opponent: row.home_team, away: true, startsAt: row.starts_at, left };
  }
  return byTeam;
}

/** "@LV" or "NO" — who they play, and the "@" if they travel. */
export function opponentLabel(game: TeamGame | null | undefined): string {
  if (!game) return "";
  return `${game.away ? "@" : ""}${game.opponent}`;
}

/**
 * "Sun 12:00 PM", in the reader's own timezone.
 *
 * Deliberately not a countdown. A time is a thing somebody can plan an
 * afternoon around; "in 3h 14m" has to be recomputed every second to stay
 * true, and is worse at the only job it has.
 */
export function kickoffLabel(startsAt: string | null | undefined): string {
  if (!startsAt) return "";
  const at = new Date(startsAt);
  if (Number.isNaN(at.getTime())) return "";
  const day = at.toLocaleDateString(undefined, { weekday: "short" });
  const time = at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return `${day} ${time}`;
}

/**
 * The whole line under a player's name: "@LV Sun 3:25 PM", or what is
 * happening instead once the game is under way.
 */
export function gameLabel(game: TeamGame | null | undefined): string {
  if (!game) return "";
  const who = opponentLabel(game);
  if (game.state === "post") return `${who} Final`;
  if (game.state === "in") return `${who} Live`;
  const when = kickoffLabel(game.startsAt);
  return when ? `${who} ${when}` : who;
}

/** A team on a bye has no row this week, which is not the same as no data. */
export function onBye(byTeam: Record<string, TeamGame>, team: string): boolean {
  return Boolean(team) && !(team in byTeam);
}
