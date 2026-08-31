import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * What this league has scored, per player, and who holds whom.
 *
 * The rankings themselves are computed in the browser from the static stat
 * tables, which are already in the bundle. Only these two things are
 * per-league, so only these two are fetched.
 */
export async function GET() {
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
    .select("id, league_id")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  const [{ data: scores }, { data: slots }, { data: managers }] = await Promise.all([
    db.from("player_scores").select("player_name, points, week").eq("league_id", me.league_id),
    db.from("roster_slots").select("player_name, manager_id").eq("league_id", me.league_id),
    db.from("managers").select("id, franchise").eq("league_id", me.league_id),
  ]);

  // A player's games are the weeks this league scored him, not the weeks on
  // the calendar: somebody added in week six has five fewer.
  const weeks = new Map<string, Set<number>>();
  const totals = new Map<string, number>();

  for (const row of scores ?? []) {
    totals.set(row.player_name, (totals.get(row.player_name) ?? 0) + Number(row.points));
    const seen = weeks.get(row.player_name) ?? new Set<number>();
    seen.add(row.week);
    weeks.set(row.player_name, seen);
  }

  const points: Record<string, { total: number; games: number }> = {};
  for (const [name, total] of totals) {
    points[name] = { total: Math.round(total * 10) / 10, games: weeks.get(name)?.size ?? 0 };
  }

  const franchiseOf = new Map((managers ?? []).map((m) => [m.id, m.franchise]));
  const rostered: Record<string, string> = {};
  for (const s of slots ?? []) {
    const franchise = franchiseOf.get(s.manager_id);
    if (franchise) rostered[s.player_name] = franchise;
  }

  return Response.json({
    points,
    rostered,
    // Whether the points column is this league's or last season's finish.
    basis: Object.keys(points).length ? "league" : "2025",
  });
}
