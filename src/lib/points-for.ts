import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What each franchise's starting lineups have scored.
 *
 * The answer comes from season_points_for, which lives in the database beside
 * best_ball_lineup so that this number and the standings cannot drift apart.
 * What is here is the part that has to survive a deploy landing before its
 * migration: a function that is not there yet fails, and both callers turn a
 * failure into an empty map — which reads as every franchise having scored
 * nothing, on the two pages a manager opens most.
 *
 * The fallback sums the graded matchups directly, which is the same arithmetic
 * for every week the league has finished and is available on any database old
 * enough to have matchups at all. It misses only the week in progress, so the
 * table stops moving mid-Sunday until the SQL is run — a table that lags is a
 * far better wrong answer than a table of noughts.
 */
export async function seasonPointsFor(
  db: SupabaseClient,
  leagueId: string,
): Promise<Map<string, number>> {
  const { data, error } = await db.rpc("season_points_for", { p_league_id: leagueId });

  if (!error) {
    return new Map(
      ((data ?? []) as { manager_id: string; points_for: number }[]).map((r) => [
        r.manager_id,
        Number(r.points_for),
      ]),
    );
  }

  console.warn("[points-for] falling back to the graded weeks", error.message);

  const { data: graded, error: gradedError } = await db
    .from("matchups")
    .select("home_manager, away_manager, home_points, away_points, playoff")
    .eq("league_id", leagueId)
    .eq("final", true);

  if (gradedError) {
    console.error("[points-for] could not read the matchups either", gradedError);
    return new Map();
  }

  const total = new Map<string, number>();
  for (const m of graded ?? []) {
    // The postseason is not the season. The same rule the function applies.
    if (m.playoff) continue;
    for (const [id, points] of [
      [m.home_manager, m.home_points],
      [m.away_manager, m.away_points],
    ] as [string | null, number | null][]) {
      if (!id) continue;
      total.set(id, (total.get(id) ?? 0) + Number(points ?? 0));
    }
  }

  for (const [id, points] of total) total.set(id, Math.round(points * 10) / 10);
  return total;
}
