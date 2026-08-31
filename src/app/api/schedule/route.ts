import { setLineup, type Score } from "@/lib/matchup";
import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * The whole season's fixtures, with a score on every one.
 *
 * A week that has been graded carries the points it was settled on — those are
 * the numbers that decided it, and recomputing them from today's rosters would
 * quietly rewrite history after a trade. A week still in progress has no
 * settled score, so that one is worked out live from the lineups on the field.
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

  const [{ data: league }, { data: managers }, { data: fixtures }] = await Promise.all([
    db.from("leagues").select("name, season, settings").eq("id", me.league_id).single(),
    db
      .from("managers")
      // pin_hash never leaves the server; it is read only to say whether
      // anybody holds the franchise yet.
      .select("id, slot, name, franchise, division, pin_hash")
      .eq("league_id", me.league_id)
      .order("slot"),
    db
      .from("matchups")
      .select("week, final, divisional, home_manager, away_manager, home_points, away_points")
      .eq("league_id", me.league_id)
      .order("week"),
  ]);

  const roster = managers ?? [];
  const schedule = fixtures ?? [];
  const byId = new Map(roster.map((m) => [m.id, m]));

  // The week being played is the first one not yet settled. Only that week
  // needs live scoring; every other week already has its answer.
  const liveWeek = schedule.find((f) => !f.final)?.week ?? null;

  const live = new Map<string, number>();
  if (liveWeek != null) {
    const [{ data: slots }, { data: scoreRows }] = await Promise.all([
      db
        .from("roster_slots")
        .select("manager_id, player_name, lineup_slot")
        .eq("league_id", me.league_id),
      db
        .from("player_scores")
        .select("player_name, points, stat_line")
        .eq("league_id", me.league_id)
        .eq("week", liveWeek),
    ]);

    const scores = new Map<string, Score>(
      (scoreRows ?? []).map((r) => [
        r.player_name,
        { points: Number(r.points), statLine: r.stat_line ?? "" },
      ]),
    );

    for (const m of roster) {
      const mine = (slots ?? []).filter((s) => s.manager_id === m.id);
      const rows = setLineup(mine, league?.settings ?? null, scores);
      live.set(
        m.id,
        Math.round(rows.reduce((sum, r) => sum + (r.entry?.points ?? 0), 0) * 10) / 10,
      );
    }
  }

  const pointsFor = (managerId: string, week: number, settled: number | null, final: boolean) => {
    if (final) return Math.round(Number(settled ?? 0) * 10) / 10;
    if (week === liveWeek) return live.get(managerId) ?? 0;
    return null;
  };

  const side = (id: string, week: number, settled: number | null, final: boolean) => {
    const m = byId.get(id);
    if (!m) return null;
    const claimed = m.pin_hash != null;
    return {
      id,
      slot: m.slot,
      // Whoever holds the franchise, or nobody yet. A seat with no manager
      // carries the placeholder name the database gave it, which is not a
      // person and should not be shown as one.
      name: claimed ? m.name : "Open",
      claimed,
      franchise: m.franchise,
      division: m.division,
      points: pointsFor(id, week, settled, final),
    };
  };

  const games = schedule
    .map((f) => ({
      week: f.week,
      final: f.final,
      divisional: f.divisional,
      live: !f.final && f.week === liveWeek,
      mine: f.home_manager === me.id || f.away_manager === me.id,
      home: side(f.home_manager, f.week, f.home_points, f.final),
      away: side(f.away_manager, f.week, f.away_points, f.final),
    }))
    .filter((g) => g.home && g.away);

  const weeks = [...new Set(schedule.map((f) => f.week))].sort((a, b) => a - b);

  return Response.json({
    meId: me.id,
    league: league ? { name: league.name, season: league.season } : null,
    weeks,
    liveWeek,
    games,
  });
}
