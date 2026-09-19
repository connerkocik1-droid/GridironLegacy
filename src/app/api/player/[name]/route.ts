import { profileFor, resolvePlayerName } from "@/lib/player-profile";
import { teamGames } from "@/lib/nfl-week";
import { currentWeek } from "@/lib/week";
import { formatStatLine, sumStatLines, type StatLine } from "@/lib/scoring";
import { fetchNews } from "@/lib/news";
import { normalizeName } from "@/lib/player-names";
import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * One player, from every source the app has.
 *
 * Who he is comes from the draft pool and the historical seasons, both local.
 * What he has done this season comes from the league's own scores. What is
 * being said about him comes from the wire. Fitness is the one thing fetched
 * separately, by the page, because it is shared across every player on screen.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name: raw } = await ctx.params;
  const asked = decodeURIComponent(raw);
  const name = resolvePlayerName(asked);
  const profile = profileFor(name);

  // The wire, narrowed to him. Failing to reach it costs the news and nothing
  // else — the rest of the page is local.
  const news = await fetchNews()
    .then((stories) =>
      stories.filter((s) => s.players.some((p) => normalizeName(p) === normalizeName(name))),
    )
    .catch(() => []);

  if (!isConfigured()) {
    return Response.json({ profile, news, season: null, owner: null, actions: null });
  }

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) return Response.json({ profile, news, season: null, owner: null, actions: null });

  const { data: me } = await db
    .from("managers")
    .select("id, league_id")
    .eq("auth_user_id", user.id)
    .single();

  if (!me) return Response.json({ profile, news, season: null, owner: null, actions: null });

  const [{ data: scores }, { data: held }, { data: league }, { data: mine }, { data: wire }] =
    await Promise.all([
      db
        .from("player_scores")
        .select("week, points, stat_line, stats")
        .eq("league_id", me.league_id)
        .eq("player_name", profile.name)
        .order("week"),
      db
        .from("roster_slots")
        .select("manager_id, lineup_slot")
        .eq("league_id", me.league_id)
        .eq("player_name", profile.name)
        .maybeSingle(),
      db.from("leagues").select("season, settings").eq("id", me.league_id).single(),
      db
        .from("roster_slots")
        .select("player_name, lineup_slot")
        .eq("league_id", me.league_id)
        .eq("manager_id", me.id),
      db
        .from("waiver_wire")
        .select("player_name, clears_at")
        .eq("league_id", me.league_id)
        .eq("player_name", profile.name)
        .maybeSingle(),
    ]);

  let owner = null;
  if (held) {
    const { data: manager } = await db
      .from("managers")
      .select("id, slot, franchise")
      .eq("id", held.manager_id)
      .single();
    owner = manager
      ? { ...manager, slot: manager.slot, mine: manager.id === me.id, lineupSlot: held.lineup_slot }
      : null;
  }

  /**
   * What this manager can actually do with him, right now.
   *
   * Worked out here rather than on the page because every input is a
   * different table — who holds him, what the league's waiver rule is, how
   * full the roster and the reserve are, whether his club has kicked off —
   * and a page that fetched all of them would draw its buttons a beat late,
   * which on a Sunday is the beat that matters.
   *
   * Refusals carry their reason. The database enforces every one of these
   * whatever the page believes, but a button that always fails is worse than
   * no button: a manager who cannot see why thinks the app is broken.
   */
  const settings = (league?.settings ?? {}) as {
    starters?: Record<string, number>;
    bench?: number;
    ir?: number;
    waiverMode?: string;
  };

  // The same shape league_starters() gives the database, so the page and the
  // scoring agree about how many men a roster holds.
  const starters = settings.starters ?? {
    QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, "D/ST": 1, K: 1,
  };
  const capacity =
    Object.values(starters).reduce((sum, n) => sum + Number(n || 0), 0) +
    Number(settings.bench ?? 8);

  // Whose game has started. A man on the field cannot be moved.
  const week = await currentWeek(db, me.league_id);
  const { data: games } = await db
    .from("nfl_games")
    .select("home_team, away_team, starts_at, state")
    .eq("season", league?.season ?? 0)
    .eq("week", week ?? 0);
  const game = teamGames(games ?? [])[profile.team ?? ""];
  const locked = game ? game.state !== "pre" : false;

  // Whether the injury report puts him where the reserve is allowed to hold
  // him. The one add that costs no roster spot, and the reason it is safe: he
  // cannot play.
  const { data: fitness } = await db
    .from("nfl_players")
    .select("injury_status")
    .eq("name", profile.name)
    .maybeSingle();
  const irEligible = ["ir", "suspended"].includes(String(fitness?.injury_status ?? ""));

  const roster = mine ?? [];
  const onIr = roster.filter((r) => r.lineup_slot === "IR").length;
  const held_ = roster.filter((r) => r.lineup_slot !== "IR" || !irEligible).length;

  const mode =
    settings.waiverMode === "open" || settings.waiverMode === "all"
      ? (settings.waiverMode as "open" | "all")
      : "waivers";

  // On the wire and not yet cleared: this is a claim rather than an add,
  // whatever the league's default is.
  const onWaivers = Boolean(wire?.clears_at && Date.parse(wire.clears_at) > Date.now());

  const actions = {
    /** "mine", "theirs", or "free". */
    where: owner ? (owner.mine ? "mine" : "theirs") : "free",
    locked,
    irEligible,
    /** Already stashed, so the offer is to bring him back rather than send him. */
    onIr: owner?.mine === true && owner.lineupSlot === "IR",
    irRoom: onIr < Number(settings.ir ?? 0),
    rosterRoom: held_ < capacity,
    /** Whether adding him would be a claim settled on the next run. */
    claim: mode === "all" || (mode === "waivers" && onWaivers),
    clearsAt: onWaivers ? (wire?.clears_at as string) : null,
    /** Who to open the trade desk against. */
    tradeWith: owner && !owner.mine ? owner.id : null,
  };

  const weeks = (scores ?? []).map((r) => ({
    week: r.week as number,
    points: Number(r.points),
    statLine: (r.stat_line as string | null) ?? "",
    stats: (r.stats ?? null) as StatLine | null,
  }));

  // The season as one line, which is what the profile leads with. Summed here
  // rather than in the page because this is where the position is known, and
  // the position decides the wording.
  const seasonLine = formatStatLine(
    sumStatLines(weeks.map((w) => w.stats).filter((s): s is StatLine => Boolean(s))),
    profile.position,
  );

  return Response.json({
    profile,
    news,
    season: {
      year: league?.season ?? null,
      weeks,
      statLine: seasonLine,
      total: Math.round(weeks.reduce((sum, w) => sum + w.points, 0) * 10) / 10,
      best: weeks.reduce((best, w) => (w.points > best ? w.points : best), 0),
    },
    owner,
    actions,
  });
}
