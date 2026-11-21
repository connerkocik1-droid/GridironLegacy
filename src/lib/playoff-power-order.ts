import type { SupabaseClient } from "@supabase/supabase-js";
import { rank, type Team } from "./power";
import { seasonPointsFor } from "./points-for";

/**
 * Every manager, ranked by power, best first.
 *
 * The at-large seats in the playoff winners bracket and the whole of the
 * losers bracket go by this order — see playoff_seeding in
 * 0067_two_brackets.sql. Power rank is this blend of record and points
 * scored, computed here rather than in SQL so the database does not grow a
 * second copy of it: the same reason the injury sync hands the database an
 * already-decided report instead of asking it to parse one.
 *
 * Points scored are the starting lineup's, the same number the League Power
 * card on the Rankings tab shows — a team's power rank should not depend on
 * which page is asking.
 */
export async function playoffPowerOrder(db: SupabaseClient, leagueId: string): Promise<string[]> {
  const [{ data: standings }, scoredFor] = await Promise.all([
    db.rpc("standings", { p_league_id: leagueId }),
    seasonPointsFor(db, leagueId),
  ]);

  interface Row {
    manager_id: string;
    wins: number;
    losses: number;
    ties: number;
    points_for: number;
  }

  const teams: Team[] = ((standings ?? []) as Row[]).map((r) => ({
    id: r.manager_id,
    wins: r.wins,
    losses: r.losses,
    ties: r.ties,
    pointsFor: scoredFor.get(r.manager_id) ?? Number(r.points_for),
  }));

  return rank(teams).map((t) => t.id);
}
