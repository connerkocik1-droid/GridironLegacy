import { freshenWeek } from "@/lib/live-refresh";
import { pairLineups, totalOf, type Score } from "@/lib/matchup";
import { isConfigured, serverClient } from "@/lib/supabase";
import { weekFrom } from "@/lib/week";

export const dynamic = "force-dynamic";

/**
 * This week's head-to-head. Returns the two lineups already paired slot by
 * slot, so the client renders rows rather than reconciling two lists.
 */
export async function GET(req: Request) {
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
    .select("id, slot, franchise, league_id")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  const { data: league } = await db
    .from("leagues")
    .select("season, settings")
    .eq("id", me.league_id)
    .single();

  const url = new URL(req.url);
  const week = await weekFrom(req, db, me.league_id);
  if (week == null) {
    return Response.json({ error: "week must be an integer" }, { status: 400 });
  }

  const oppParam = url.searchParams.get("opponent");

  // Whether the week is being played, and a pull scheduled for after this
  // response if what we hold has gone stale.
  const state = await freshenWeek(db, me.league_id, league?.season, week);

  const { data: managers } = await db
    .from("managers")
    .select("id, slot, franchise")
    .eq("league_id", me.league_id)
    .order("slot");

  const roster = managers ?? [];

  // The week's real fixture. A manager with no row that week has a bye, which
  // is a genuine outcome in an odd league rather than an error.
  const { data: fixture } = await db
    .from("matchups")
    .select("home_manager, away_manager, final, home_points, away_points, home_starters, away_starters")
    .eq("league_id", me.league_id)
    .eq("week", week)
    .or(`home_manager.eq.${me.id},away_manager.eq.${me.id}`)
    .maybeSingle();

  const scheduledOpponentId = fixture
    ? fixture.home_manager === me.id
      ? fixture.away_manager
      : fixture.home_manager
    : null;

  // An explicit opponent overrides the fixture, so any two teams can be
  // compared; otherwise the schedule decides.
  const opponent = oppParam
    ? roster.find((m) => m.id === oppParam)
    : roster.find((m) => m.id === scheduledOpponentId);

  if (!opponent) {
    return Response.json({
      week,
      bye: fixture == null && !oppParam,
      scheduled: fixture != null,
      me,
      managers: roster,
      error:
        fixture == null && !oppParam
          ? "You have a bye this week."
          : "No opponent for this week",
    }, { status: fixture == null && !oppParam ? 200 : 404 });
  }

  const { data: slots } = await db
    .from("roster_slots")
    .select("player_name, manager_id, lineup_slot")
    .eq("league_id", me.league_id)
    .in("manager_id", [me.id, opponent.id]);

  // Injured reserve is out of the week entirely, on both sides: a stashed
  // player does not count against a roster, so he cannot score for one.
  const active = (slots ?? []).filter((s) => s.lineup_slot !== "IR");
  const mine = active.filter((s) => s.manager_id === me.id);
  const theirs = active.filter((s) => s.manager_id === opponent.id);

  const { data: scoreRows } = await db
    .from("player_scores")
    .select("player_name, points, stat_line, stats")
    .eq("league_id", me.league_id)
    .eq("week", week)
    .in("player_name", [...mine, ...theirs].map((s) => s.player_name));

  const scores = new Map<string, Score>(
    (scoreRows ?? []).map((r) => [
      r.player_name,
      { points: Number(r.points), statLine: r.stat_line ?? "", line: r.stats ?? undefined },
    ]),
  );

  // "home" on the fixture is whoever the schedule put there; "home" in this
  // response is always the signed-in manager, so the snapshot is turned round
  // to match before it is handed over.
  const iAmHome = fixture?.home_manager === me.id;
  const frozen =
    fixture?.final && !oppParam
      ? {
          home: iAmHome ? fixture.home_starters : fixture.away_starters,
          away: iAmHome ? fixture.away_starters : fixture.home_starters,
        }
      : null;

  // Nobody sets a lineup here. Each side is the best arrangement its whole
  // roster can make — projected until the slate starts, and from then on the
  // real one, refilling on every read as the scores move. It is the same rule
  // grade_week freezes when the last game ends, so what a manager watches all
  // afternoon is what he is graded on.
  const rows = pairLineups(
    mine,
    theirs,
    league?.settings ?? null,
    scores,
    state.started ? "points" : "projection",
    // Once the week is final the arrangement is not recomputed at all. What
    // grade_week wrote down is what happened, and a trade in November must not
    // be able to change who won in September.
    frozen,
  );

  return Response.json({
    week,
    scheduled: fixture != null && !oppParam,
    final: fixture?.final ?? false,
    // "home" is always the signed-in manager, so the client never has to work
    // out which column is theirs.
    home: { ...me, total: totalOf(rows, "home") },
    away: { ...opponent, total: totalOf(rows, "away") },
    rows,
    // A game in progress, rather than "we hold some numbers for this week" —
    // which stayed true from the first kickoff until the next season.
    live: state.live,
    started: state.started,
    weekPhase: state.phase,
    managers: roster,
  });
}
