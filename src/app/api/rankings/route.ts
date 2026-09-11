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
    db
      .from("player_scores")
      .select("player_name, points, week, stats")
      .eq("league_id", me.league_id),
    db.from("roster_slots").select("player_name, manager_id").eq("league_id", me.league_id),
    db.from("managers").select("id, franchise").eq("league_id", me.league_id),
  ]);

  // A player's games are the weeks this league scored him, not the weeks on
  // the calendar: somebody added in week six has five fewer.
  const weeks = new Map<string, Set<number>>();
  const totals = new Map<string, number>();

  // And what he actually did on the field, added up across the season. The
  // board used to put this league's points beside last season's football, so a
  // receiver with one touchdown in his one game read 0.59 TD/G — last year's
  // rate, in a column headed by this year's points. Two seasons in one row is
  // not a ranking of anything.
  const line = new Map<string, Record<string, number>>();
  // Games counted per statistic, not per player: a back who never sees a
  // target has no receiving games, and dividing his receptions by the weeks he
  // ran the ball would say he is a receiver who catches nothing.
  const appearances = new Map<string, Record<string, number>>();

  for (const row of scores ?? []) {
    totals.set(row.player_name, (totals.get(row.player_name) ?? 0) + Number(row.points));
    const seen = weeks.get(row.player_name) ?? new Set<number>();
    seen.add(row.week);
    weeks.set(row.player_name, seen);

    const week = (row.stats ?? {}) as Record<string, unknown>;
    const summed = line.get(row.player_name) ?? {};
    const seenIn = appearances.get(row.player_name) ?? {};
    for (const [key, value] of Object.entries(week)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      summed[key] = (summed[key] ?? 0) + value;
      seenIn[key] = (seenIn[key] ?? 0) + 1;
    }
    line.set(row.player_name, summed);
    appearances.set(row.player_name, seenIn);
  }

  const points: Record<string, { total: number; games: number }> = {};
  for (const [name, total] of totals) {
    points[name] = { total: Math.round(total * 10) / 10, games: weeks.get(name)?.size ?? 0 };
  }

  const played: Record<string, { line: Record<string, number>; games: Record<string, number> }> =
    {};
  for (const [name, summed] of line) {
    played[name] = { line: summed, games: appearances.get(name) ?? {} };
  }

  const franchiseOf = new Map((managers ?? []).map((m) => [m.id, m.franchise]));
  const rostered: Record<string, string> = {};
  for (const s of slots ?? []) {
    const franchise = franchiseOf.get(s.manager_id);
    if (franchise) rostered[s.player_name] = franchise;
  }

  return Response.json({
    points,
    played,
    rostered,
    // Whether the points column is this league's or last season's finish.
    basis: Object.keys(points).length ? "league" : "2025",
  });
}
