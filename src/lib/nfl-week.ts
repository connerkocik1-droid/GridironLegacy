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
}

export interface TeamGame {
  state: GameState;
  /** The other team. */
  opponent: string;
  /** True when this team is away, which is what the "@" in "@LV" means. */
  away: boolean;
  /** ISO, formatted on the client so it lands in the reader's own timezone. */
  startsAt: string;
}

/** The week's games, keyed by each team playing in them. */
export function teamGames(rows: NflGameRow[]): Record<string, TeamGame> {
  const byTeam: Record<string, TeamGame> = {};
  for (const row of rows) {
    const state: GameState =
      row.state === "in" || row.state === "post" ? row.state : "pre";
    byTeam[row.home_team] = { state, opponent: row.away_team, away: false, startsAt: row.starts_at };
    byTeam[row.away_team] = { state, opponent: row.home_team, away: true, startsAt: row.starts_at };
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
