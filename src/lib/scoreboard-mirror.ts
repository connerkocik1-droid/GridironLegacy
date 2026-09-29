import type { Game, SeasonType } from "./espn";
import type { serviceClient } from "./supabase";

type Db = ReturnType<typeof serviceClient>;

/**
 * The scoreboard as the mirror last saw it, for when ESPN will not answer.
 *
 * The scoreboard route used to answer an ESPN failure with an empty board,
 * and a 200 at that — so the ticker, whose whole design is to keep what it was
 * showing through a failed refresh, dropped the strip in the middle of a
 * Sunday instead. In week 3 that was twenty-three times.
 *
 * The league already keeps every game of the week in nfl_games — scores,
 * state, and since 0062 the quarter and the clock — written by every score
 * refresh. That is a few minutes behind at worst, and a board that is a few
 * minutes behind and says so is worth far more than no board.
 */

/** One nfl_games row, as select("*") returns it. */
export interface MirrorRow {
  id: string;
  season: number;
  week: number;
  season_type: number;
  starts_at: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  state: string;
  winner: string | null;
  completed: boolean;
  updated_at?: string | null;
  period?: number | null;
  clock?: number | null;
}

const ORDINAL: Record<number, string> = { 1: "1st", 2: "2nd", 3: "3rd", 4: "4th" };

/**
 * ESPN's short status line for a game in progress — "7:56 - 3rd",
 * "Halftime" — from the quarter and clock the mirror kept. Empty when there
 * is no clock to read, which the boards already draw as "LIVE".
 */
export function mirrorStatus(row: Pick<MirrorRow, "state" | "period" | "clock">): string {
  if (row.state !== "in") return "";
  const period = Number(row.period);
  if (row.period == null || !Number.isFinite(period) || period < 1) return "";
  const quarter = period > 4 ? "OT" : ORDINAL[period];

  const clock = Number(row.clock);
  if (row.clock == null || !Number.isFinite(clock)) return quarter;
  if (clock <= 0) return period === 2 ? "Halftime" : `End of ${quarter}`;

  const minutes = Math.floor(clock / 60);
  const seconds = Math.floor(clock % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")} - ${quarter}`;
}

/** A mirrored row as the Game the boards already know how to draw. */
export function gameFromMirror(row: MirrorRow): Game {
  const state: Game["state"] = row.state === "in" || row.state === "post" ? row.state : "pre";
  const side = (abbrev: string, score: number, homeAway: "home" | "away") => ({
    abbrev,
    // The boards draw the abbreviation and their own club marks; the mirror
    // keeps neither the full name nor ESPN's logo, and neither is missed.
    name: abbrev,
    score: Number(score ?? 0),
    homeAway,
    winner: row.winner === abbrev,
    logo: "",
    linescores: [],
  });

  return {
    id: String(row.id),
    date: row.starts_at,
    week: Number(row.week),
    seasonType: (Number(row.season_type) || 2) as SeasonType,
    state,
    completed: Boolean(row.completed),
    statusDetail: mirrorStatus({ ...row, state }),
    home: side(row.home_team, row.home_score, "home"),
    away: side(row.away_team, row.away_score, "away"),
    situation: null,
    period: state === "in" ? (row.period ?? null) : null,
    clock: state === "in" ? (row.clock ?? null) : null,
  };
}

/**
 * The games of a week from the mirror, oldest kickoff first, and when the
 * mirror last heard about any of them. Without a week, the most recent one
 * that has started. Null when the mirror has nothing to offer.
 */
export async function mirroredSlate(
  db: Db,
  want: { season?: number | null; week?: number | null; seasonType?: SeasonType | null },
): Promise<{ games: Game[]; asOf: string | null } | null> {
  let season = want.season ?? null;
  let week = want.week ?? null;
  let seasonType: number = want.seasonType ?? 2;

  if (season == null || week == null) {
    const { data: latest } = await db
      .from("nfl_games")
      .select("season, week, season_type")
      .lte("starts_at", new Date().toISOString())
      .order("starts_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!latest) return null;
    season = Number(latest.season);
    week = Number(latest.week);
    seasonType = Number(latest.season_type) || 2;
  }

  const { data, error } = await db
    .from("nfl_games")
    .select("*")
    .eq("season", season)
    .eq("week", week)
    .eq("season_type", seasonType)
    .order("starts_at", { ascending: true });

  if (error || !data?.length) return null;

  const rows = data as MirrorRow[];
  const asOf = rows.reduce<string | null>(
    (latest, r) => (r.updated_at && (!latest || r.updated_at > latest) ? r.updated_at : latest),
    null,
  );
  return { games: rows.map(gameFromMirror), asOf };
}
