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

  // The week's real fixture. A manager with no row that week has a bye, which
  // is a genuine outcome in an odd league rather than an error.
  const { data: fixture } = await db
    .from("matchups")
    .select("home_manager, away_manager, final, home_points, away_points")
    .eq("league_id", me.league_id)
    .eq("week", week)
    .or(`home_manager.eq.${me.id},away_manager.eq.${me.id}`)
    .maybeSingle();

  const scheduledOpponentId = fixture
    ? fixture.home_manager === me.id
      ? fixture.away_manager
      : fixture.home_manager
    : null;

  // An explicit opponent overrides the fixture, so any two teams can be
  // compared; otherwise the schedule decides.
  const opponent = oppParam
    ? roster.find((m) => m.id === oppParam)
    : roster.find((m) => m.id === scheduledOpponentId);

  if (!opponent) {
    return Response.json({
      week,
      bye: fixture == null && !oppParam,
      scheduled: fixture != null,
      me,
      managers: roster,
      error:
        fixture == null && !oppParam
          ? "You have a bye this week."
          : "No opponent for this week",
    }, { status: fixture == null && !oppParam ? 200 : 404 });
  }

  const { data: slots } = await db
    .from("roster_slots")
    .select("player_name, manager_id, lineup_slot")
    .eq("league_id", me.league_id)
    .in("manager_id", [me.id, opponent.id]);

  const mine = (slots ?? []).filter((s) => s.manager_id === me.id);
  const theirs = (slots ?? []).filter((s) => s.manager_id === opponent.id);

  const { data: scoreRows } = await db
    .from("player_scores")
    .select("player_name, points, stat_line")
    .eq("league_id", me.league_id)
    .eq("week", week)
    .in("player_name", [...mine, ...theirs].map((s) => s.player_name));

  const scores = new Map<string, Score>(
    (scoreRows ?? []).map((r) => [
      r.player_name,
      { points: Number(r.points), statLine: r.stat_line ?? "" },
    ]),
  );

  // The lineup each manager actually set. A manager who has never set one
  // falls back to their best legal lineup, so a team is never fielded empty.
  const rows = pairLineups(mine, theirs, league?.settings ?? null, scores);

  return Response.json({
    week,
    scheduled: fixture != null && !oppParam,
    final: fixture?.final ?? false,
    // "home" is always the signed-in manager, so the client never has to work
    // out which column is theirs.
    home: { ...me, total: totalOf(rows, "home") },
    away: { ...opponent, total: totalOf(rows, "away") },
    rows,
    live: scores.size > 0,
    managers: roster,
  });
}
