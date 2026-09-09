import { bestLineup, type Score } from "@/lib/matchup";
import { teamGames } from "@/lib/nfl-week";
import { outlookOf, winProbability, type Outlook } from "@/lib/win-probability";
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
  const outlooks = new Map<string, Outlook>();
  if (liveWeek != null) {
    const [{ data: slots }, { data: scoreRows }, { data: nflGames }] = await Promise.all([
      db
        .from("roster_slots")
        .select("manager_id, player_name, lineup_slot")
        .eq("league_id", me.league_id),
      db
        .from("player_scores")
        .select("player_name, points, stat_line, stats")
        .eq("league_id", me.league_id)
        .eq("week", liveWeek),
      // The real football, so a card can say how much of the week each side
      // still has left rather than only what it has so far.
      db
        .from("nfl_games")
        .select("home_team, away_team, starts_at, state")
        .eq("season", league?.season ?? 0)
        .eq("week", liveWeek),
    ]);
    const byTeam = teamGames(nflGames ?? []);
    const knowTheWeek = Object.keys(byTeam).length > 0;

    const scores = new Map<string, Score>(
      (scoreRows ?? []).map((r) => [
        r.player_name,
        { points: Number(r.points), statLine: r.stat_line ?? "", line: r.stats ?? undefined },
      ]),
    );

    // Anything scored at all means the week is being played, so the lineup is
    // arranged on real points; before that there is nothing to arrange it on
    // and the projection stands in.
    const basis = (scoreRows ?? []).length ? "points" : "projection";

    for (const m of roster) {
      const mine = (slots ?? [])
        .filter((s) => s.manager_id === m.id && s.lineup_slot !== "IR")
        .map((s) => s.player_name);
      const rows = bestLineup(mine, league?.settings ?? null, scores, basis);
      live.set(
        m.id,
        Math.round(rows.reduce((sum, r) => sum + (r.entry?.points ?? 0), 0) * 10) / 10,
      );
      // The real score rather than the entry's, which is a projection until
      // the slate starts. See the same reasoning in api/matchup.
      outlooks.set(
        m.id,
        outlookOf(
          rows.map((r) =>
            r.entry && {
              points: scores.get(r.entry.name)?.points ?? 0,
              projected: r.entry.projected,
              state: knowTheWeek ? (byTeam[r.entry.team]?.state ?? "post") : ("pre" as const),
            },
          ),
        ),
      );
    }
  }

  /**
   * Everybody's record, counted once from the settled weeks.
   *
   * Every card carries the two managers' records, so working this out per
   * card would be twelve passes over the same fixtures. It is also the number
   * the matchups page used to compute for the reader alone, in the client,
   * which meant a card could show somebody else's name with no record beside
   * it.
   */
  const records = new Map<string, { w: number; l: number; t: number }>(
    roster.map((m) => [m.id, { w: 0, l: 0, t: 0 }]),
  );
  for (const f of schedule) {
    if (!f.final) continue;
    const h = Number(f.home_points ?? 0);
    const a = Number(f.away_points ?? 0);
    const home = records.get(f.home_manager);
    const away = records.get(f.away_manager);
    if (!home || !away) continue;
    if (h > a) { home.w++; away.l++; }
    else if (h < a) { home.l++; away.w++; }
    else { home.t++; away.t++; }
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
      record: records.get(id) ?? { w: 0, l: 0, t: 0 },
      // Only the week being played has an outlook: a week still to come has
      // no lineup yet, and a graded one has an answer instead of a forecast.
      projected: week === liveWeek ? (outlooks.get(id)?.projected ?? null) : null,
      yetToPlay: week === liveWeek ? (outlooks.get(id)?.yetToPlay ?? null) : null,
      inPlay: week === liveWeek ? (outlooks.get(id)?.inPlay ?? null) : null,
    };
  };

  /**
   * The chance the home side wins, where that can be said at all.
   *
   * A settled week is a result, not a forecast, so it answers 1 or 0. A week
   * nobody has played and that is not the one in progress has no lineups to
   * forecast from, and answers null rather than a made-up coin toss.
   */
  const chanceOf = (f: { week: number; final: boolean; home_manager: string; away_manager: string; home_points: number | null; away_points: number | null }) => {
    if (f.final) {
      const h = Number(f.home_points ?? 0);
      const a = Number(f.away_points ?? 0);
      return h > a ? 1 : h < a ? 0 : 0.5;
    }
    if (f.week !== liveWeek) return null;
    const home = outlooks.get(f.home_manager);
    const away = outlooks.get(f.away_manager);
    return home && away ? winProbability(home, away) : null;
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
      winProbability: chanceOf(f),
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
