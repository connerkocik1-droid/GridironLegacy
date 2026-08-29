import { POOL } from "@/data/league-data";
import { fetchGameStats, fetchScoreboard } from "@/lib/espn";
import { scoreGame, type ScoringFormat } from "@/lib/scoring";
import { serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  // Mirror the schedule first, so a later ESPN outage cannot strand pick-'em.
  const gameRows = games.flatMap((g) => {
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
        season: league.season,
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

  if (gameRows.length) {
    const { error } = await db.from("nfl_games").upsert(gameRows);
    if (error) console.error("[cron/scores] schedule upsert failed", error);
  }

  // Only games that have started can have a box score.
  const live = games.filter((g) => g.state !== "pre");
  const rostered = new Set(POOL.map((p) => p.n));
  const scoreRows: Record<string, unknown>[] = [];

  for (const game of live) {
    try {
      const stats = await fetchGameStats(game.id);
      for (const player of scoreGame(stats, format, rostered)) {
        scoreRows.push({
          league_id: leagueId,
          week,
          player_name: player.name,
          points: player.points,
          stat_line: player.statLine,
          updated_at: new Date().toISOString(),
        });
      }
    } catch (err) {
      // One bad game must not cost the whole run.
      console.error(`[cron/scores] game ${game.id} failed`, err);
    }
  }

  if (scoreRows.length) {
    const { error } = await db.from("player_scores").upsert(scoreRows);
    if (error) {
      console.error("[cron/scores] score upsert failed", error);
      return Response.json({ error: "Failed to write scores" }, { status: 500 });
    }
  }

  return Response.json({
    week,
    games: gameRows.length,
    live: live.length,
    players: scoreRows.length,
  });
}
