import { serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Settles the claims that are ripe and releases the players nobody won.
 *
 * Nightly rather than weekly. A player dropped on Thursday sits on the wire
 * for his waiver period and is then judged at the next run — if that run only
 * came on Wednesdays, the period would be decoration and half the league's
 * drops would be untouchable for the best part of a week.
 *
 * Everything that decides who gets a player is in process_waivers(), so this
 * only has to authorise the run and report what happened.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const leagueId = process.env.LEAGUE_ID;
  if (!leagueId) return Response.json({ error: "LEAGUE_ID is not set" }, { status: 500 });

  const db = serviceClient();
  const { data, error } = await db.rpc("process_waivers", { p_league_id: leagueId });

  if (error) {
    console.error("[cron/waivers] failed", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}
