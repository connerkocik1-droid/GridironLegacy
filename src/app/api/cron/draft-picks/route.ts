import { serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Hands out next season's draft picks, and puts them in order.
 *
 * Runs nightly. Two things happen, and the difference between them is the
 * whole point: picks that do not exist yet are created, and the order of the
 * ones that do is recomputed from the current standings. Ownership is never
 * touched, so a pick somebody traded for in October is still theirs in
 * November.
 *
 * Nightly rather than once, because draft position is the inverse of a record
 * and a record changes every week. A pick's worth should move with the team it
 * came from while there is still time to trade it.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const leagueId = process.env.LEAGUE_ID;
  if (!leagueId) return Response.json({ error: "LEAGUE_ID is not set" }, { status: 500 });

  const db = serviceClient();
  const { data, error } = await db.rpc("award_draft_picks", { p_league_id: leagueId });

  if (error) {
    console.error("[cron/draft-picks] failed", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}
