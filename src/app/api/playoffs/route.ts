import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Both brackets, once there are any.
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
        .select("bracket, seed, manager_id")
        .eq("league_id", me.league_id)
        .eq("season", season)
        .order("bracket")
        .order("seed"),
      db
        .from("matchups")
        .select(
          "id, week, bracket, playoff_round, home_manager, away_manager, home_points, away_points, winner, is_tie, final",
        )
        .eq("league_id", me.league_id)
        .eq("playoff", true)
        .order("bracket")
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

  // One bracket's slice of the feed: its seeds, its rounds, how long it will
  // take. Built the same way for 'winners' and 'losers' so the two always
  // agree about what a round number means within their own field.
  function bracketFeed(bracket: "winners" | "losers") {
    const mySeeds = (seeds ?? []).filter((s) => s.bracket === bracket);
    if (!mySeeds.length) return null;

    const myGames = (games ?? []).filter((g) => g.bracket === bracket);

    const rounds = new Map<number, unknown[]>();
    for (const g of myGames) {
      const round = g.playoff_round ?? 1;
      if (!rounds.has(round)) rounds.set(round, []);
      rounds.get(round)!.push({
        id: g.id,
        week: g.week,
        final: g.final,
        // A drawn playoff game is not a draw: the better seed goes through,
        // the same rule the database applies when it draws the next round.
        winner:
          g.winner ??
          (g.final && g.is_tie
            ? (seedOf.get(g.home_manager) ?? 99) < (seedOf.get(g.away_manager) ?? 99)
              ? g.home_manager
              : g.away_manager
            : null),
        onSeed: g.final && g.is_tie,
        home: { ...side(g.home_manager), points: Number(g.home_points) },
        away: { ...side(g.away_manager), points: Number(g.away_points) },
      });
    }

    return {
      // How many rounds this bracket will take, from the size of its own
      // field — NOT from how many have been drawn so far. Counting the drawn
      // ones would rename this week's semi-final into a final as the weeks
      // went by, which is the one thing a round name must never do.
      totalRounds: Math.max(1, Math.ceil(Math.log2(Math.max(mySeeds.length, 2)))),
      seeds: mySeeds.map((s) => ({
        seed: s.seed,
        ...side(s.manager_id),
        // Nobody drew a fixture in the first round: they had a bye.
        bye: !myGames.some(
          (g) =>
            g.playoff_round === 1 &&
            (g.home_manager === s.manager_id || g.away_manager === s.manager_id),
        ),
      })),
      rounds: [...rounds.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([round, games]) => ({ round, games })),
    };
  }

  return Response.json({
    seeded: true,
    season,
    me,
    champions: champions ?? [],
    winners: bracketFeed("winners"),
    losers: bracketFeed("losers"),
  });
}
