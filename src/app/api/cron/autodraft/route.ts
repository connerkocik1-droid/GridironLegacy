import { POOL } from "@/data/league-data";
import { serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Picks for a manager whose clock has run out.
 *
 * A browser that is closed cannot pick for itself, so without this one absent
 * manager stalls the whole draft. Runs every minute while a draft is on; it is
 * a no-op whenever nobody's clock has expired.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const leagueId = process.env.LEAGUE_ID;
  if (!leagueId) return Response.json({ error: "LEAGUE_ID is not set" }, { status: 500 });

  const db = serviceClient();

  const { data: league } = await db
    .from("leagues")
    .select("draft_state")
    .eq("id", leagueId)
    .single();

  if (league?.draft_state !== "running") {
    return Response.json({ ok: false, reason: "draft not running" });
  }

  // The fallback when a manager has queued nobody: the best player left by
  // consensus ADP. Worked out here because the pool lives in the app, not the
  // database.
  const { data: taken } = await db
    .from("roster_slots")
    .select("player_name")
    .eq("league_id", leagueId);

  const rostered = new Set((taken ?? []).map((r) => r.player_name));
  const best = POOL.filter((p) => !rostered.has(p.n)).sort((a, b) => a.adp - b.adp)[0];

  const { data, error } = await db.rpc("autodraft_expired", {
    p_league_id: leagueId,
    p_fallback: best?.n ?? null,
  });

  if (error) {
    console.error("[cron/autodraft] failed", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}
