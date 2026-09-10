import { refreshScores } from "@/lib/live";
import { plan } from "@/lib/backfill";
import { serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Re-scores weeks that were scored before the whole pool was.
 *
 * Scoring used to be written only for rostered players, so a free agent who
 * played has no history — no points, no stat line, nothing on his page. This
 * fills it in. Run it once after deploying the fix:
 *
 *   curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/backfill
 *
 * With nothing named it does every week the season has reached; `?week=1` or
 * `?from=1&to=4` narrow it. Four weeks a run, because sixteen games a week is
 * a lot of requests and the platform stops listening eventually — the
 * response names whatever it did not reach so you know to go again.
 *
 * It deliberately does NOT grade. Records are frozen on the matchups row when
 * a week is settled, and re-grading now would score today's roster against a
 * week it did not play: a manager who picked somebody up on Tuesday would be
 * credited with his Sunday. Writing scores is safe; rewriting history is not.
 *
 * Not scheduled. It is a repair, not a routine.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const leagueId = process.env.LEAGUE_ID;
  if (!leagueId) return Response.json({ error: "LEAGUE_ID is not set" }, { status: 500 });

  const db = serviceClient();

  // How far the season has actually got, so "everything" means something.
  const { data: fixtures } = await db
    .from("matchups")
    .select("week, final")
    .eq("league_id", leagueId)
    .eq("final", true)
    .order("week", { ascending: false })
    .limit(1);

  const { data: scored } = await db
    .from("player_scores")
    .select("week")
    .eq("league_id", leagueId)
    .order("week", { ascending: false })
    .limit(1);

  // Whichever is further on: a week in play has scores but is not yet final,
  // and it is exactly the week somebody wants filled in.
  const playedThrough = Math.max(
    Number(fixtures?.[0]?.week ?? 0),
    Number(scored?.[0]?.week ?? 0),
  );

  const asked = plan(new URL(req.url).searchParams, playedThrough);
  if (asked.error) return Response.json({ error: asked.error }, { status: 400 });

  const done: { week: number; players: number; failed: number; note?: string }[] = [];

  // One at a time. In parallel they would ask ESPN for sixty game summaries at
  // once, which is how a backfill turns into a rate limit.
  for (const week of asked.weeks) {
    const result = await refreshScores(db, leagueId, { force: true, week });
    done.push({
      week,
      players: result.players,
      failed: result.failed,
      ...(result.note ? { note: result.note } : {}),
    });
  }

  return Response.json({
    backfilled: done,
    remaining: asked.remaining,
    graded: false,
    note: asked.remaining.length
      ? `Run again for weeks ${asked.remaining.join(", ")}.`
      : "Every week asked for was re-scored. Records were not touched.",
  });
}
