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

  const [{ data: league }, { data: managers }, { data: slots }, { data: scores }, { data: table }] =
    await Promise.all([
      db.from("leagues").select("name, season, settings").eq("id", me.league_id).single(),
      db
        .from("managers")
        .select("id, slot, name, franchise, is_commissioner, pin_hash, division")
        .eq("league_id", me.league_id)
        .order("slot"),
      db
        .from("roster_slots")
        .select("manager_id, player_name, lineup_slot, acquired")
        .eq("league_id", me.league_id),
      db.from("player_scores").select("player_name, points, week").eq("league_id", me.league_id),
      db.rpc("standings", { p_league_id: me.league_id }),
    ]);

  // Records come from graded weeks; a league that has not played yet has none,
  // and the page says so rather than showing a table of zeroes as if it were
  // standings.
  const record = new Map(
    (table ?? []).map((r: { manager_id: string; wins: number; losses: number; ties: number; div_wins: number; div_losses: number; points_for: number; points_against: number }) => [
      r.manager_id,
      {
        divWins: r.div_wins,
        divLosses: r.div_losses,
        wins: r.wins,
        losses: r.losses,
        ties: r.ties,
        pointsFor: Number(r.points_for),
        pointsAgainst: Number(r.points_against),
      },
    ]),
  );

  const played = (table ?? []).some(
    (r: { wins: number; losses: number; ties: number }) => r.wins + r.losses + r.ties > 0,
  );

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
    played,
    franchises: (managers ?? []).map((m) => ({
      id: m.id,
      slot: m.slot,
      name: m.name,
      franchise: m.franchise,
      division: m.division,
      claimed: m.pin_hash != null,
      isCommissioner: m.is_commissioner,
      pointsFor: Math.round((pointsFor.get(m.id) ?? 0) * 10) / 10,
      record: record.get(m.id) ?? null,
      roster: (slots ?? [])
        .filter((s) => s.manager_id === m.id)
        .map((s) => ({ name: s.player_name, slot: s.lineup_slot, acquired: s.acquired })),
    })),
  });
}
