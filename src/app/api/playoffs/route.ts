import { isConfigured, serverClient } from "@/lib/supabase";
import { bracketShape, firstRound, playoffPicture, type PictureTeam } from "@/lib/playoff-picture";

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

  const [{ data: seeds }, { data: allGames }, { data: managers }, { data: champions }, { data: consolationSeeds }, { data: finish }] =
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
          "id, week, playoff_round, bracket, for_place, home_manager, away_manager, home_points, away_points, winner, is_tie, final",
        )
        .eq("league_id", me.league_id)
        .eq("playoff", true)
        .order("playoff_round")
        .order("week"),
      db.from("managers").select("id, name, franchise, slot, division").eq("league_id", me.league_id),
      db
        .from("league_champions")
        .select("season, manager_id, franchise, decided_at")
        .eq("league_id", me.league_id)
        .order("season", { ascending: false }),
      db.from("consolation_seeds").select("seed, manager_id").eq("league_id", me.league_id).eq("season", season).order("seed"),
      db.from("season_finish").select("place, manager_id, franchise").eq("league_id", me.league_id).eq("season", season).order("place"),
    ]);

  // The title bracket is what the rounds are; placement and consolation games
  // are listed beside it.
  const games = (allGames ?? []).filter((g) => (g.bracket ?? "title") === "title");

  const by = new Map((managers ?? []).map((m) => [m.id, m]));
  const seedOf = new Map([...(seeds ?? []), ...(consolationSeeds ?? [])].map((s) => [s.manager_id, s.seed]));

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

  if (!seeds || seeds.length === 0) {
    // Before the bracket: the playoff picture, if the season ended today. The
    // order is the database's own seeding(), so the seeds shown here are the
    // ones start_playoffs will write down when the last regular week closes.
    const [{ data: order }, { data: table }, { data: field }, { data: regular }] = await Promise.all([
      db.rpc("seeding", { p_league_id: me.league_id }),
      db.rpc("standings", { p_league_id: me.league_id }),
      db.rpc("playoff_field", { p_league_id: me.league_id }),
      db
        .from("matchups")
        .select("week, home_manager, away_manager, final")
        .eq("league_id", me.league_id)
        .eq("playoff", false),
    ]);

    const fixtures = regular ?? [];
    const seeding = ((order ?? []) as { seed: number; manager_id: string }[]).sort((a, b) => a.seed - b.seed);
    if (!seeding.length || !fixtures.length) {
      // No schedule yet: there is no picture to draw, only the record book.
      return Response.json({ seeded: false, season, champions: champions ?? [], me });
    }

    const records = new Map(
      ((table ?? []) as { manager_id: string; wins: number; losses: number; ties: number }[]).map((r) => [r.manager_id, r]),
    );
    const teams: PictureTeam[] = (managers ?? []).map((m) => {
      const r = records.get(m.id);
      return {
        id: m.id,
        division: (m as { division?: string | null }).division ?? null,
        wins: r?.wins ?? 0,
        losses: r?.losses ?? 0,
        ties: r?.ties ?? 0,
        remaining: fixtures.filter((f) => !f.final && (f.home_manager === m.id || f.away_manager === m.id)).length,
      };
    });

    const { shape, rows } = playoffPicture(teams, seeding.map((s) => s.manager_id), Number(field ?? 6));
    const bySeed = new Map(rows.map((r) => [r.seed, r.id]));
    const regularWeeks = Math.max(...fixtures.map((f) => f.week));

    return Response.json({
      seeded: false,
      season,
      champions: champions ?? [],
      me,
      picture: {
        ...shape,
        regularWeeks,
        weeksLeft: new Set(fixtures.filter((f) => !f.final).map((f) => f.week)).size,
        rows: rows.map((r) => {
          const t = teams.find((x) => x.id === r.id)!;
          return { ...r, ...side(r.id), seed: r.seed, record: { wins: t.wins, losses: t.losses, ties: t.ties }, division: t.division };
        }),
        // Who would play whom in the first round, if the season ended today.
        firstRound: firstRound(shape).map(([hi, lo]) => ({ week: regularWeeks + 1, home: { ...side(bySeed.get(hi) ?? null), seed: hi }, away: { ...side(bySeed.get(lo) ?? null), seed: lo } })),
        // And the consolation for everybody outside the field: best against
        // worst, the losers playing on for last place.
        consolation: (() => {
          const games: { home: unknown; away: unknown }[] = [];
          for (let hi = shape.field + 1, lo = rows.length; hi < lo; hi++, lo--) {
            games.push({ home: { ...side(bySeed.get(hi) ?? null), seed: hi }, away: { ...side(bySeed.get(lo) ?? null), seed: lo } });
          }
          return games;
        })(),
      },
    });
  }

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

  // Who is out, and in which round: the loser of every settled game, with a
  // level game going to the better seed, as above.
  const outIn = new Map<string, number>();
  for (const g of games ?? []) {
    if (!g.final) continue;
    const winner =
      g.winner ??
      ((seedOf.get(g.home_manager) ?? 99) < (seedOf.get(g.away_manager) ?? 99) ? g.home_manager : g.away_manager);
    outIn.set(winner === g.home_manager ? g.away_manager : g.home_manager, g.playoff_round ?? 1);
  }
  const shape = bracketShape(seeds.length);
  // Placement and consolation games, each with the place it decides.
  const sideGame = (g: NonNullable<typeof allGames>[number]) => ({
    id: g.id,
    week: g.week,
    round: g.playoff_round ?? 1,
    forPlace: g.for_place ?? null,
    final: g.final,
    winner:
      g.winner ??
      (g.final ? ((seedOf.get(g.home_manager) ?? 99) < (seedOf.get(g.away_manager) ?? 99) ? g.home_manager : g.away_manager) : null),
    home: { ...side(g.home_manager), points: Number(g.home_points) },
    away: { ...side(g.away_manager), points: Number(g.away_points) },
  });
  const firstWeek = Math.min(...(games ?? []).map((g) => g.week));
  const champion = (champions ?? []).find((c) => c.season === season);

  return Response.json({
    seeded: true,
    season,
    me,
    champions: champions ?? [],
    ...shape,
    // The week each round is played in, drawn or not: one round a week from
    // the week after the regular season.
    roundWeeks: Array.from({ length: shape.rounds }, (_, i) => (Number.isFinite(firstWeek) ? firstWeek + i : null)),
    // How many rounds the bracket will take, from the size of the field —
    // NOT from how many have been drawn so far. Counting the drawn ones would
    // rename this week's quarter-final into a semi-final and then into the
    // final as the weeks went by, which is the one thing a round name must
    // never do.
    totalRounds: Math.max(1, Math.ceil(Math.log2(Math.max(seeds.length, 2)))),
    seeds: seeds.map((s) => ({
      seed: s.seed,
      ...side(s.manager_id),
      status: champion?.manager_id === s.manager_id ? "champion" : outIn.has(s.manager_id) ? "out" : "alive",
      outIn: outIn.get(s.manager_id) ?? null,
      // Nobody drew a fixture in the first round: they had a bye.
      bye: !(games ?? []).some(
        (g) =>
          g.playoff_round === 1 && (g.home_manager === s.manager_id || g.away_manager === s.manager_id),
      ),
    })),
    placement: (allGames ?? []).filter((g) => g.bracket === "place").map(sideGame),
    consolation: (allGames ?? []).filter((g) => g.bracket === "consolation").map(sideGame),
    consolationSeeds: (consolationSeeds ?? []).map((s) => ({ seed: s.seed, ...side(s.manager_id) })),
    // The final order, once the last game is done: last place picks first.
    finish: (finish ?? []).map((f) => ({ place: f.place, ...side(f.manager_id), franchise: f.franchise })),
    drawn: [...rounds.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([round, games]) => ({ round, games })),
  });
}
