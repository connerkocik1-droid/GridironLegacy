import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * The bracket, once there is one.
 *
 * Returns `seeded: false` for the whole of the regular season, which is most
 * of the year — the page that asks for this draws nothing at all until the
 * postseason exists rather than an empty bracket implying one is coming.
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

  const { data: league } = await db
    .from("leagues")
    .select("season")
    .eq("id", me.league_id)
    .single();
  const season = league?.season ?? null;

  const [{ data: seeds }, { data: games }, { data: managers }, { data: champions }] =
    await Promise.all([
      db
        .from("playoff_seeds")
        .select("seed, manager_id")
        .eq("league_id", me.league_id)
        .eq("season", season)
        .order("seed"),
      db
        .from("matchups")
        .select(
          "id, week, playoff_round, home_manager, away_manager, home_points, away_points, winner, is_tie, final",
        )
        .eq("league_id", me.league_id)
        .eq("playoff", true)
        .order("playoff_round")
        .order("week"),
      db.from("managers").select("id, name, franchise, slot").eq("league_id", me.league_id),
      db
        .from("league_champions")
        .select("season, manager_id, franchise, decided_at")
        .eq("league_id", me.league_id)
        .order("season", { ascending: false }),
    ]);

  if (!seeds || seeds.length === 0) {
    // The record book still exists in the years before this one.
    return Response.json({ seeded: false, season, champions: champions ?? [], me });
  }

  const by = new Map((managers ?? []).map((m) => [m.id, m]));
  const seedOf = new Map(seeds.map((s) => [s.manager_id, s.seed]));

  const side = (id: string | null) =>
    id
      ? {
          id,
          franchise: by.get(id)?.franchise ?? "Unknown",
          who: by.get(id)?.name ?? null,
          seed: seedOf.get(id) ?? null,
          mine: id === me.id,
        }
      : null;

  const rounds = new Map<number, unknown[]>();
  for (const g of games ?? []) {
    const round = g.playoff_round ?? 1;
    if (!rounds.has(round)) rounds.set(round, []);
    rounds.get(round)!.push({
      id: g.id,
      week: g.week,
      final: g.final,
      // A drawn playoff game is not a draw: the better seed goes through, the
      // same rule the database applies when it draws the next round.
      winner:
        g.winner ??
        (g.final && g.is_tie
          ? ((seedOf.get(g.home_manager) ?? 99) < (seedOf.get(g.away_manager) ?? 99)
              ? g.home_manager
              : g.away_manager)
          : null),
      onSeed: g.final && g.is_tie,
      home: { ...side(g.home_manager), points: Number(g.home_points) },
      away: { ...side(g.away_manager), points: Number(g.away_points) },
    });
  }

  return Response.json({
    seeded: true,
    season,
    me,
    champions: champions ?? [],
    // How many rounds the bracket will take, from the size of the field —
    // NOT from how many have been drawn so far. Counting the drawn ones would
    // rename this week's quarter-final into a semi-final and then into the
    // final as the weeks went by, which is the one thing a round name must
    // never do.
    totalRounds: Math.max(1, Math.ceil(Math.log2(Math.max(seeds.length, 2)))),
    seeds: seeds.map((s) => ({
      seed: s.seed,
      ...side(s.manager_id),
      // Nobody drew a fixture in the first round: they had a bye.
      bye: !(games ?? []).some(
        (g) =>
          g.playoff_round === 1 && (g.home_manager === s.manager_id || g.away_manager === s.manager_id),
      ),
    })),
    rounds: [...rounds.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([round, games]) => ({ round, games })),
  });
}
