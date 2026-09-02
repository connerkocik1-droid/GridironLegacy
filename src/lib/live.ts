import {
  fetchGameDetail,
  fetchScoreboard,
  type Game,
  type SeasonType,
} from "./espn";
import { NameIndex, defenseTeamName, isDefense } from "./player-names";
import { scoreGameDetail, type ScoringFormat, type StatLine } from "./scoring";
import type { serviceClient } from "./supabase";

type Db = ReturnType<typeof serviceClient>;

/**
 * How stale the week's scores may get before the next person to look pays for
 * a refresh.
 *
 * Twenty seconds while the ball is in the air. A fantasy score moves on
 * scoring plays, which come minutes apart, so this is already finer-grained
 * than the thing it is measuring — and it bounds what twelve managers hitting
 * refresh can do to an API that owes us nothing.
 */
const LIVE_STALE_SECONDS = 20;

/** Between slates there is nothing to refresh, so barely bother. */
const IDLE_STALE_SECONDS = 600;

/** How long a finished week stays worth re-reading, for late stat corrections. */
const SETTLED_STALE_SECONDS = 1800;

export type WeekPhase = "upcoming" | "live" | "final";

export interface WeekState {
  phase: WeekPhase;
  /** Anything on the slate has kicked off, so there are scores worth showing. */
  started: boolean;
  /** A game is in progress this second. */
  live: boolean;
}

/** What the phase of a week implies about how hard to chase it. */
export function staleSecondsFor(state: WeekState): number {
  if (state.live) return LIVE_STALE_SECONDS;
  if (state.phase === "final") return SETTLED_STALE_SECONDS;
  return IDLE_STALE_SECONDS;
}

export function phaseOf(games: Game[]): WeekState {
  if (!games.length) return { phase: "upcoming", started: false, live: false };

  const live = games.some((g) => g.state === "in");
  const started = games.some((g) => g.state !== "pre");
  const allDone = games.every((g) => g.state === "post");

  return {
    phase: live ? "live" : allDone ? "final" : started ? "live" : "upcoming",
    started,
    live,
  };
}

export interface PulledWeek {
  week: number;
  seasonType: SeasonType;
  games: Game[];
  state: WeekState;
  /** Every rostered player who scored, keyed by the league's own spelling. */
  scores: Map<string, { points: number; statLine: string; line: StatLine }>;
  /** Games whose box score could not be read. */
  failed: string[];
  /** Points the summary proved happened but could not pin on a player. */
  unattributed: string[];
  fetchedAt: string;
}

/**
 * The week as ESPN has it right now, scored against this league's rosters.
 *
 * Pinned to the regular season on purpose. Asking ESPN for "whatever is on"
 * would, in August, hand back a preseason box score and award a manager six
 * points for a touchdown scored by a third-string tight end in the second
 * quarter of a game his starters watched from the sideline.
 */
export async function pullWeek(
  rostered: Iterable<string>,
  format: ScoringFormat,
  opts: { week?: number; seasonType?: SeasonType } = {},
): Promise<PulledWeek> {
  const names = [...rostered];
  const games = await fetchScoreboard(opts.week, opts.seasonType ?? 2);

  const state = phaseOf(games);
  const fetchedAt = new Date().toISOString();
  const week = games[0]?.week ?? opts.week ?? 0;
  const seasonType = games[0]?.seasonType ?? opts.seasonType ?? 2;

  const empty: PulledWeek = {
    week,
    seasonType,
    games,
    state,
    scores: new Map(),
    failed: [],
    unattributed: [],
    fetchedAt,
  };

  if (!games.length || !names.length) return empty;

  const index = new NameIndex(names);

  // Which team defenses are rostered, by the abbreviation the unit plays for.
  // The pool names them "Seattle Seahawks D/ST", so the abbreviation is
  // recovered from the games themselves rather than a second name table that
  // would drift the first time a team moved city.
  const defenseByAbbrev = new Map<string, string>();
  for (const name of names) {
    if (!isDefense(name)) continue;
    const abbrev = abbrevOf(defenseTeamName(name), games);
    if (abbrev) defenseByAbbrev.set(abbrev, name);
  }

  const scores = new Map<string, { points: number; statLine: string; line: StatLine }>();
  const failed: string[] = [];
  const unattributed: string[] = [];

  // Only games that have started have a box score worth reading, and asking
  // for thirteen summaries when none of them has kicked off is thirteen
  // requests for a page of zeroes.
  const played = games.filter((g) => g.state !== "pre");

  // In parallel, because a Sunday afternoon slate is thirteen games and doing
  // them one after another is thirteen round trips a manager waits through.
  const details = await Promise.all(
    played.map(async (game) => {
      try {
        return { game, detail: await fetchGameDetail(game.id) };
      } catch (err) {
        console.error(`[live] game ${game.id} failed`, err);
        failed.push(game.id);
        return null;
      }
    }),
  );

  for (const entry of details) {
    if (!entry) continue;
    const { game, detail } = entry;
    if (!game.home || !game.away) continue;

    const scored = scoreGameDetail(
      detail,
      [
        { abbrev: game.home.abbrev, score: game.home.score },
        { abbrev: game.away.abbrev, score: game.away.score },
      ],
      format,
      index,
    );

    for (const player of scored.players) {
      scores.set(player.name, {
        points: player.points,
        statLine: player.statLine,
        line: player.line,
      });
    }

    for (const [abbrev, defense] of scored.defenses) {
      const name = defenseByAbbrev.get(abbrev);
      if (!name) continue;
      scores.set(name, {
        points: defense.points,
        statLine: defense.statLine,
        line: defense.line,
      });
    }

    unattributed.push(...scored.unattributed.map((note) => `${game.id}: ${note}`));
  }

  return { week, seasonType, games, state, scores, failed, unattributed, fetchedAt };
}

/**
 * "Seattle Seahawks" -> "SEA", from the scoreboard's own team list rather than
 * a table of our own that could fall out of date.
 */
function abbrevOf(fullName: string, games: Game[]): string | null {
  const want = fullName.toLowerCase();
  for (const game of games) {
    for (const side of [game.home, game.away]) {
      if (side && side.name.toLowerCase() === want) return side.abbrev;
    }
  }
  return null;
}

export interface RefreshResult {
  refreshed: boolean;
  week: number | null;
  players: number;
  failed: number;
  state: WeekState | null;
  note?: string;
}

const NOT_REFRESHED: RefreshResult = {
  refreshed: false,
  week: null,
  players: 0,
  failed: 0,
  state: null,
};

/**
 * Pulls the week and writes it down — the one path that puts a number in
 * player_scores, whether it was a cron or a manager opening the home page
 * that set it going.
 *
 * `force` skips the throttle and belongs to the cron alone. Every other caller
 * asks politely and is told no most of the time, which is the point.
 */
export async function refreshScores(
  db: Db,
  leagueId: string,
  opts: { force?: boolean; week?: number } = {},
): Promise<RefreshResult> {
  const { data: league } = await db
    .from("leagues")
    .select("season, settings")
    .eq("id", leagueId)
    .single();

  if (!league) return { ...NOT_REFRESHED, note: "league not found" };

  const format = (league.settings?.scoring ?? "half") as ScoringFormat;

  // Scored against the rosters as they actually stand, not the static draft
  // pool: a waiver pickup from outside the original five hundred would
  // otherwise never score a point.
  const { data: rosterRows } = await db
    .from("roster_slots")
    .select("player_name")
    .eq("league_id", leagueId);

  const rostered = (rosterRows ?? []).map((r) => r.player_name);

  const pulled = await pullWeek(rostered, format, { week: opts.week });
  if (!pulled.games.length) return { ...NOT_REFRESHED, note: "no games" };

  await mirrorSchedule(db, pulled.games, league.season);

  if (!rostered.length) {
    return {
      refreshed: true,
      week: pulled.week,
      players: 0,
      failed: pulled.failed.length,
      state: pulled.state,
      note: "no rosters yet",
    };
  }

  const rows = [...pulled.scores].map(([player_name, score]) => ({
    league_id: leagueId,
    week: pulled.week,
    player_name,
    points: score.points,
    stat_line: score.statLine,
    stats: score.line,
    updated_at: pulled.fetchedAt,
  }));

  if (rows.length) {
    const { error } = await db.from("player_scores").upsert(rows);
    if (error) {
      console.error("[live] score upsert failed", error);
      return { ...NOT_REFRESHED, week: pulled.week, note: "write failed" };
    }
  }

  for (const note of pulled.unattributed) console.warn(`[live] ${note}`);

  return {
    refreshed: true,
    week: pulled.week,
    players: rows.length,
    failed: pulled.failed.length,
    state: pulled.state,
  };
}

/**
 * Refreshes only if nobody else has recently, and only if the week is one
 * where a refresh could change anything.
 *
 * The decision is made in Postgres, not here, because "here" is one of an
 * unknown number of instances that cannot see each other. `claim_score_refresh`
 * hands out exactly one yes per window.
 */
export async function maybeRefreshScores(
  db: Db,
  leagueId: string,
  state: WeekState,
  week: number,
): Promise<RefreshResult> {
  const { data: claimed, error } = await db.rpc("claim_score_refresh", {
    p_league_id: leagueId,
    p_week: week,
    p_stale_seconds: staleSecondsFor(state),
  });

  if (error) {
    // A missing function means migration 0031 has not been run. Say so once,
    // clearly, rather than failing the page the manager actually asked for.
    console.error("[live] could not claim a refresh", error.message);
    return { ...NOT_REFRESHED, note: "claim failed" };
  }

  if (!claimed) return { ...NOT_REFRESHED, note: "fresh enough" };

  return refreshScores(db, leagueId);
}

/**
 * What the NFL is doing for a given week, read from the mirror rather than
 * from ESPN.
 *
 * This is what the home page's "next matchup" versus "current matchup" turns
 * on, so it has to be about the games rather than about our own data: whether
 * a score row exists says only that somebody once ran the ingestion, and stays
 * true all week and all of the following one.
 */
export async function weekState(
  db: { from: Db["from"] },
  season: number,
  week: number,
): Promise<WeekState> {
  const { data } = await db
    .from("nfl_games")
    .select("state, starts_at")
    .eq("season", season)
    .eq("week", week)
    .eq("season_type", 2);

  const games = data ?? [];
  if (!games.length) return { phase: "upcoming", started: false, live: false };

  const states = games.map((g) => g.state as string);
  const now = Date.now();

  // A game whose kickoff has passed while the mirror still calls it "pre" does
  // not mean the game has not started. It means this table is out of date —
  // which is the one moment a refresh is most worth doing, and exactly the
  // moment a naive reading of it would decide nothing is happening and wait
  // ten minutes. Kickoff is the tie-breaker, because it is the one field that
  // is true in advance and cannot go stale.
  const kickedOff = games.some(
    (g) => g.state === "pre" && new Date(g.starts_at as string).getTime() <= now,
  );

  const live = states.includes("in") || kickedOff;
  const started = live || states.some((s) => s !== "pre");
  const allDone = !kickedOff && states.every((s) => s === "post");

  return {
    phase: live ? "live" : allDone ? "final" : started ? "live" : "upcoming",
    started,
    live,
  };
}

/** Mirrors the schedule, so a later ESPN outage cannot strand grading. */
export async function mirrorSchedule(db: Db, games: Game[], season: number) {
  const now = new Date().toISOString();

  const rows = games.flatMap((g) => {
    if (!g.home || !g.away) return [];
    const winner = !g.completed
      ? null
      : g.home.score > g.away.score
        ? g.home.abbrev
        : g.away.score > g.home.score
          ? g.away.abbrev
          : null; // a tie has no winner

    return [
      {
        id: g.id,
        season,
        week: g.week,
        season_type: g.seasonType,
        starts_at: g.date,
        home_team: g.home.abbrev,
        away_team: g.away.abbrev,
        home_score: g.home.score,
        away_score: g.away.score,
        state: g.state,
        winner,
        completed: g.completed,
        updated_at: now,
      },
    ];
  });

  if (!rows.length) return;
  const { error } = await db.from("nfl_games").upsert(rows);
  if (error) console.error("[live] schedule upsert failed", error);
}
