import { refreshScores } from "@/lib/live";
import { serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The week's scores, written down and then acted on.
 *
 * The pulling and the scoring live in lib/live.ts, which is also what a
 * manager opening the home page during a game sets going. One implementation
 * of the arithmetic, so a score watched live and the score recorded against a
 * franchise's season are the same number rather than two attempts at it.
 *
 * What is only here is what must not happen on a page load: grading the week,
 * and moving the postseason on. Those change records, and a record should
 * change because the season moved, not because somebody hit refresh.
 *
 * Scheduled from vercel.json. Vercel Cron sends the shared secret; nothing
 * else may run it, because it writes with the service key.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const leagueId = process.env.LEAGUE_ID;
  if (!leagueId) return Response.json({ error: "LEAGUE_ID is not set" }, { status: 500 });

  const db = serviceClient();

  // Forced: the cron is the schedule, so it never asks the throttle whether
  // this is a good moment.
  const result = await refreshScores(db, leagueId, { force: true });

  if (result.week == null) {
    return Response.json({ ...result, graded: false, postseason: null });
  }

  // Grade the week from the scores just written. This is what turns points
  // into records; it freezes the week once its games are over.
  const { error: gradeError } = await db.rpc("grade_week", {
    p_league_id: leagueId,
    p_week: result.week,
  });
  if (gradeError) console.error("[cron/scores] grading failed", gradeError);

  // Grading is what ends the regular season, so the postseason is moved on in
  // the same breath. advance_playoffs decides for itself whether anything is
  // owed — it seeds the bracket when the last regular week goes final, draws
  // the next round when the previous one is complete, and crowns a champion
  // when one team is left. On any other night it does nothing.
  const { data: postseason, error: playoffError } = await db.rpc("advance_playoffs", {
    p_league_id: leagueId,
  });
  if (playoffError) console.error("[cron/scores] playoffs failed", playoffError);

  return Response.json({
    ...result,
    graded: !gradeError,
    postseason: postseason ?? null,
  });
}
