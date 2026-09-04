import { autodraftPick } from "@/lib/autodraft";
import { serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Picks for a manager whose clock has run out, or who said they would not be
 * here at all.
 *
 * The draft room now triggers the same call on any poll, which is five seconds
 * rather than a minute — so on a normal draft night this cron never has
 * anything to do. It stays because it is the only path that works when nobody
 * has the room open: a draft everybody has walked away from still has to
 * finish, and a browser cannot be relied on to be the thing that finishes it.
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
    .select("draft_state, current_pick, settings")
    .eq("id", leagueId)
    .single();

  if (league?.draft_state !== "running") {
    return Response.json({ ok: false, reason: "draft not running" });
  }

  // Whose pick it is, and how deep into the draft — both of which decide what
  // the fallback should be. A ninth-round pick and a first-round pick are not
  // the same question even with the same board.
  const { data: onTheClock } = await db
    .from("draft_picks")
    .select("manager_id, round")
    .eq("league_id", leagueId)
    .eq("overall", league.current_pick)
    .maybeSingle();

  if (!onTheClock?.manager_id) {
    return Response.json({ ok: false, reason: "nobody on the clock" });
  }

  const [{ data: taken }, { count: totalPicks }, { count: teams }] = await Promise.all([
    db.from("roster_slots").select("player_name, manager_id").eq("league_id", leagueId),
    db.from("draft_picks").select("id", { count: "exact", head: true }).eq("league_id", leagueId),
    db.from("managers").select("id", { count: "exact", head: true }).eq("league_id", leagueId),
  ]);

  const held = (taken ?? []) as { player_name: string; manager_id: string }[];

  // The fallback when a manager has queued nobody. Not "best left by ADP",
  // which drafts a fourth quarterback in the ninth round and finishes the
  // night without a kicker — the same reasoning the mock draft's opponents
  // use: ADP, argued with by the lineup still to fill and the byes already
  // collected. Worked out here because the pool lives in the app, not the
  // database; the queue itself is read inside the transaction that picks.
  const fallback = autodraftPick({
    taken: new Set(held.map((r) => r.player_name)),
    roster: held.filter((r) => r.manager_id === onTheClock.manager_id).map((r) => r.player_name),
    round: onTheClock.round,
    rounds: Math.max(
      onTheClock.round,
      teams && totalPicks ? Math.ceil(totalPicks / teams) : onTheClock.round,
    ),
    league: league.settings ?? {},
  });

  const { data, error } = await db.rpc("autodraft_expired", {
    p_league_id: leagueId,
    p_fallback: fallback,
  });

  if (error) {
    console.error("[cron/autodraft] failed", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json(data);
}
