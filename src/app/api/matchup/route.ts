import { pairLineups, totalOf, type Score } from "@/lib/matchup";
import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * This week's head-to-head. Returns the two lineups already paired slot by
 * slot, so the client renders rows rather than reconciling two lists.
 */
export async function GET(req: Request) {
  if (!isConfigured()) {
    return Response.json({ error: "The league database is not configured yet." }, { status: 503 });
  }

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { data: me } = await db
    .from("managers")
    .select("id, slot, franchise, league_id")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  const { data: league } = await db
    .from("leagues")
    .select("settings")
    .eq("id", me.league_id)
    .single();

  const url = new URL(req.url);
  const weekParam = url.searchParams.get("week");
  const week = weekParam ? Number(weekParam) : 1;
  if (!Number.isInteger(week)) {
    return Response.json({ error: "week must be an integer" }, { status: 400 });
  }

  const oppParam = url.searchParams.get("opponent");

  const { data: managers } = await db
    .from("managers")
    .select("id, slot, franchise")
    .eq("league_id", me.league_id)
    .order("slot");

  const roster = managers ?? [];
  const myIndex = roster.findIndex((m) => m.id === me.id);

  // Until a real schedule exists, managers are paired off in slot order. The
  // opponent can be overridden so any two teams can be compared.
  const opponent = oppParam
    ? roster.find((m) => m.id === oppParam)
    : roster[myIndex % 2 === 0 ? myIndex + 1 : myIndex - 1];

  if (!opponent) {
    return Response.json({ error: "No opponent for this week" }, { status: 404 });
  }

  const { data: slots } = await db
    .from("roster_slots")
    .select("player_name, manager_id")
    .eq("league_id", me.league_id)
    .in("manager_id", [me.id, opponent.id]);

  const mine = (slots ?? []).filter((s) => s.manager_id === me.id).map((s) => s.player_name);
  const theirs = (slots ?? []).filter((s) => s.manager_id === opponent.id).map((s) => s.player_name);

  const { data: scoreRows } = await db
    .from("player_scores")
    .select("player_name, points, stat_line")
    .eq("league_id", me.league_id)
    .eq("week", week)
    .in("player_name", [...mine, ...theirs]);

  const scores = new Map<string, Score>(
    (scoreRows ?? []).map((r) => [
      r.player_name,
      { points: Number(r.points), statLine: r.stat_line ?? "" },
    ]),
  );

  const rows = pairLineups(mine, theirs, league?.settings ?? null, scores);

  return Response.json({
    week,
    // "home" is always the signed-in manager, so the client never has to work
    // out which column is theirs.
    home: { ...me, total: totalOf(rows, "home") },
    away: { ...opponent, total: totalOf(rows, "away") },
    rows,
    live: scores.size > 0,
    managers: roster,
  });
}
