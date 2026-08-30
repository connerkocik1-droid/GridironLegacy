import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Every franchise, its roster and what it has scored.
 *
 * Read-only and visible to any signed-in manager — a league where you cannot
 * see the other rosters is not much of a league.
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

  const [{ data: league }, { data: managers }, { data: slots }, { data: scores }] =
    await Promise.all([
      db.from("leagues").select("name, season, settings").eq("id", me.league_id).single(),
      db
        .from("managers")
        .select("id, slot, name, franchise, is_commissioner, pin_hash")
        .eq("league_id", me.league_id)
        .order("slot"),
      db
        .from("roster_slots")
        .select("manager_id, player_name, lineup_slot, acquired")
        .eq("league_id", me.league_id),
      db.from("player_scores").select("player_name, points, week").eq("league_id", me.league_id),
    ]);

  // Points for, by manager: every week a rostered player has scored. Without a
  // season schedule there are no records to stand on, so this is the honest
  // ordering — total production, not a fabricated W-L.
  const owner = new Map((slots ?? []).map((s) => [s.player_name, s.manager_id]));
  const pointsFor = new Map<string, number>();

  for (const row of scores ?? []) {
    const managerId = owner.get(row.player_name);
    if (!managerId) continue;
    pointsFor.set(managerId, (pointsFor.get(managerId) ?? 0) + Number(row.points));
  }

  const weeks = new Set((scores ?? []).map((s) => s.week));

  return Response.json({
    meId: me.id,
    league,
    weeksScored: weeks.size,
    franchises: (managers ?? []).map((m) => ({
      id: m.id,
      slot: m.slot,
      name: m.name,
      franchise: m.franchise,
      claimed: m.pin_hash != null,
      isCommissioner: m.is_commissioner,
      pointsFor: Math.round((pointsFor.get(m.id) ?? 0) * 10) / 10,
      roster: (slots ?? [])
        .filter((s) => s.manager_id === m.id)
        .map((s) => ({ name: s.player_name, slot: s.lineup_slot, acquired: s.acquired })),
    })),
  });
}
