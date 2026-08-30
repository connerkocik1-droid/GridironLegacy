import { fetchGameStats, fetchScoreboard, type Game, type PlayerStat } from "@/lib/espn";
import { scoreDefense, scoreGame, type ScoringFormat } from "@/lib/scoring";
import { serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

interface ScoreRow {
  league_id: string;
  week: number;
  player_name: string;
  points: number;
  stat_line: string;
  updated_at: string;
}

/**
 * Pulls the week's box scores from ESPN, scores every rostered player, and
 * mirrors the schedule and results so pick-'em can be graded without ESPN
 * being reachable at that moment.
 *
 * Scheduled from vercel.json on game days. Vercel Cron sends the shared
 * secret; nothing else may run it, because it writes with the service key.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const leagueId = process.env.LEAGUE_ID;
  if (!leagueId) return Response.json({ error: "LEAGUE_ID is not set" }, { status: 500 });

  const db = serviceClient();

  const { data: league, error: leagueError } = await db
    .from("leagues")
    .select("season, settings")
    .eq("id", leagueId)
    .single();

  if (leagueError || !league) {
    return Response.json({ error: "League not found" }, { status: 404 });
  }

  const format = (league.settings?.scoring ?? "half") as ScoringFormat;

  const games = await fetchScoreboard();
  if (!games.length) return Response.json({ games: 0, players: 0, note: "no games" });

  const week = games[0].week;
  await mirrorSchedule(db, games, league.season);

  // Score against the rosters as they actually stand, not the static draft
  // pool: a waiver pickup outside the original 585 would otherwise never
  // score a point.
  const { data: rosterRows } = await db
    .from("roster_slots")
    .select("player_name")
    .eq("league_id", leagueId);

  const rostered = new Set((rosterRows ?? []).map((r) => r.player_name));
  if (!rostered.size) {
    return Response.json({ week, games: games.length, players: 0, note: "no rosters yet" });
  }

  // Which team defenses are rostered, by the abbreviation the unit plays for.
  // The pool names them "Seattle Seahawks D/ST", so the abbreviation is
  // recovered from the games themselves rather than a second name table.
  const defenseByAbbrev = new Map<string, string>();
  for (const name of rostered) {
    if (!name.endsWith("D/ST")) continue;
    const team = teamAbbrevFor(name, games);
    if (team) defenseByAbbrev.set(team, name);
  }

  const live = games.filter((g) => g.state !== "pre");
  const rows: ScoreRow[] = [];
  const now = new Date().toISOString();
  let failed = 0;

  for (const game of live) {
    try {
      const stats = await fetchGameStats(game.id);

      for (const player of scoreGame(stats, format, rostered)) {
        rows.push({
          league_id: leagueId,
          week,
          player_name: player.name,
          points: player.points,
          stat_line: player.statLine,
          updated_at: now,
        });
      }

      // Each defense is scored against what the other side put up.
      for (const [side, other] of [
        [game.home, game.away],
        [game.away, game.home],
      ] as const) {
        if (!side || !other) continue;
        const name = defenseByAbbrev.get(side.abbrev);
        if (!name) continue;

        const scored = scoreDefense(stats, side.abbrev, other.score);
        rows.push({
          league_id: leagueId,
          week,
          player_name: name,
          points: scored.points,
          stat_line: scored.statLine,
          updated_at: now,
        });
      }
    } catch (err) {
      // One bad game must not cost the whole run.
      failed++;
      console.error(`[cron/scores] game ${game.id} failed`, err);
    }
  }

  if (rows.length) {
    const { error } = await db.from("player_scores").upsert(rows);
    if (error) {
      console.error("[cron/scores] score upsert failed", error);
      return Response.json({ error: "Failed to write scores" }, { status: 500 });
    }
  }

  // Grade the week from the scores just written. This is what turns points
  // into records; it freezes the week once its games are over.
  const { error: gradeError } = await db.rpc("grade_week", {
    p_league_id: leagueId,
    p_week: week,
  });
  if (gradeError) console.error("[cron/scores] grading failed", gradeError);

  return Response.json({
    week,
    games: games.length,
    live: live.length,
    failed,
    players: rows.length,
    graded: !gradeError,
  });
}

/** Mirrors the schedule first, so a later ESPN outage cannot strand grading. */
async function mirrorSchedule(
  db: ReturnType<typeof serviceClient>,
  games: Game[],
  season: number,
) {
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
        season_type: 2,
        starts_at: g.date,
        home_team: g.home.abbrev,
        away_team: g.away.abbrev,
        home_score: g.home.score,
        away_score: g.away.score,
        state: g.state,
        winner,
        completed: g.completed,
        updated_at: new Date().toISOString(),
      },
    ];
  });

  if (!rows.length) return;
  const { error } = await db.from("nfl_games").upsert(rows);
  if (error) console.error("[cron/scores] schedule upsert failed", error);
}

/**
 * "Seattle Seahawks D/ST" -> "SEA". The scoreboard carries each team's full
 * display name beside its abbreviation, so the two are matched there rather
 * than kept as a separate table that could drift.
 */
function teamAbbrevFor(defenseName: string, games: Game[]): string | null {
  const full = defenseName.replace(/\s*D\/ST\s*$/, "").trim().toLowerCase();

  for (const game of games) {
    for (const side of [game.home, game.away]) {
      if (side && side.name.toLowerCase() === full) return side.abbrev;
    }
  }
  return null;
}

export type { PlayerStat };
