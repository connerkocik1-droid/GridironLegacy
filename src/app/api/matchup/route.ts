import { freshenWeek } from "@/lib/live-refresh";
import { pairLineups, totalOf, type Score } from "@/lib/matchup";
import { teamGames } from "@/lib/nfl-week";
import { outlookOf, winProbability } from "@/lib/win-probability";
import { isConfigured, serverClient } from "@/lib/supabase";
import { weekFrom } from "@/lib/week";

export const dynamic = "force-dynamic";

/**
 * A head-to-head, paired slot by slot so the client renders rows rather than
 * reconciling two lists.
 *
 * Any two franchises, not only the caller and somebody. `?home=` names the
 * left-hand side and defaults to the signed-in manager; `?opponent=` names the
 * right and defaults to whoever the schedule put opposite the left. So the
 * bare call is still "my week", `?opponent=X` is still "how would I do against
 * X", and `?home=A&opponent=B` is two other franchises read in full — which is
 * what makes every fixture on the home page somewhere you can go.
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
    .select("id, slot, name, franchise, league_id")
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
  const homeParam = url.searchParams.get("home");

  // Whether the week is being played, and a pull scheduled for after this
  // response if what we hold has gone stale.
  const state = await freshenWeek(db, me.league_id, league?.season, week);

  const { data: managers } = await db
    .from("managers")
    // The person, not just the franchise. A team name is something somebody
    // made up; the name under it is who you are actually playing.
    .select("id, slot, name, franchise")
    .eq("league_id", me.league_id)
    .order("slot");

  const roster = managers ?? [];

  // The left-hand side. The signed-in manager unless somebody is named, which
  // is what lets a fixture between two other franchises be opened at all.
  const left = (homeParam ? roster.find((m) => m.id === homeParam) : null) ?? me;
  const mine = left.id === me.id;

  // The week's real fixture for whoever is on the left. A manager with no row
  // that week has a bye, which is a genuine outcome in an odd league rather
  // than an error.
  const { data: fixture } = await db
    .from("matchups")
    .select("home_manager, away_manager, final, home_points, away_points, home_starters, away_starters")
    .eq("league_id", me.league_id)
    .eq("week", week)
    .or(`home_manager.eq.${left.id},away_manager.eq.${left.id}`)
    .maybeSingle();

  const scheduledOpponentId = fixture
    ? fixture.home_manager === left.id
      ? fixture.away_manager
      : fixture.home_manager
    : null;

  // An explicit opponent overrides the fixture, so any two teams can be
  // compared; otherwise the schedule decides.
  const opponent = oppParam
    ? roster.find((m) => m.id === oppParam)
    : roster.find((m) => m.id === scheduledOpponentId);

  if (!opponent) {
    const bye = fixture == null && !oppParam;
    return Response.json({
      week,
      bye,
      scheduled: fixture != null,
      mine,
      me,
      managers: roster,
      error: bye
        ? mine
          ? "You have a bye this week."
          : `${left.franchise} have a bye this week.`
        : "No opponent for this week",
    }, { status: bye ? 200 : 404 });
  }

  const { data: slots } = await db
    .from("roster_slots")
    .select("player_name, manager_id, lineup_slot")
    .eq("league_id", me.league_id)
    .in("manager_id", [left.id, opponent.id]);

  // Injured reserve is out of the week entirely, on both sides: a stashed
  // player does not count against a roster, so he cannot score for one.
  const active = (slots ?? []).filter((s) => s.lineup_slot !== "IR");
  const ours = active.filter((s) => s.manager_id === left.id);
  const theirs = active.filter((s) => s.manager_id === opponent.id);

  const { data: scoreRows } = await db
    .from("player_scores")
    .select("player_name, points, stat_line, stats")
    .eq("league_id", me.league_id)
    .eq("week", week)
    .in("player_name", [...ours, ...theirs].map((s) => s.player_name));

  const scores = new Map<string, Score>(
    (scoreRows ?? []).map((r) => [
      r.player_name,
      { points: Number(r.points), statLine: r.stat_line ?? "", line: r.stats ?? undefined },
    ]),
  );

  // The week's real football, which the league already stores for the
  // pick-'em. It is what turns a column of noughts into something readable:
  // a nought beside a man who has finished is a disaster, and the identical
  // nought beside a man kicking off at four is nothing at all.
  const { data: games } = await db
    .from("nfl_games")
    .select("home_team, away_team, starts_at, state")
    .eq("season", league?.season ?? 0)
    .eq("week", week);
  const byTeam = teamGames(games ?? []);

  // Every final result in the league, for the records under the two names.
  const { data: settled } = await db
    .from("matchups")
    .select("home_manager, away_manager, home_points, away_points")
    .eq("league_id", me.league_id)
    .eq("final", true);

  const recordOf = (id: string) => {
    let w = 0, l = 0, t = 0;
    for (const f of settled ?? []) {
      const home = f.home_manager === id;
      if (!home && f.away_manager !== id) continue;
      const ours = Number(home ? f.home_points : f.away_points);
      const theirs = Number(home ? f.away_points : f.home_points);
      if (ours > theirs) w++;
      else if (ours < theirs) l++;
      else t++;
    }
    return { w, l, t };
  };

  // Whether the pair being asked for is actually the week's fixture between
  // them, either way round.
  //
  // This decides whether the frozen snapshot applies, and it used to be
  // "?opponent= was not given" — which quietly meant that naming your own
  // scheduled opponent explicitly, as every link from the matchups list does,
  // recomputed a settled week instead of showing what was graded. Two routes
  // to the same finished game disagreed about its score.
  const isTheFixture =
    fixture != null &&
    ((fixture.home_manager === left.id && fixture.away_manager === opponent.id) ||
      (fixture.away_manager === left.id && fixture.home_manager === opponent.id));

  // "home" on the fixture is whoever the schedule put there; "home" in this
  // response is always the left-hand franchise, so the snapshot is turned
  // round to match before it is handed over.
  const leftIsHome = fixture?.home_manager === left.id;
  const frozen =
    fixture?.final && isTheFixture
      ? {
          home: leftIsHome ? fixture.home_starters : fixture.away_starters,
          away: leftIsHome ? fixture.away_starters : fixture.home_starters,
        }
      : null;

  // Nobody sets a lineup here. Each side is the best arrangement its whole
  // roster can make — projected until the slate starts, and from then on the
  // real one, refilling on every read as the scores move. It is the same rule
  // grade_week freezes when the last game ends, so what a manager watches all
  // afternoon is what he is graded on.
  const rows = pairLineups(
    ours,
    theirs,
    league?.settings ?? null,
    scores,
    state.started ? "points" : "projection",
    // Once the week is final the arrangement is not recomputed at all. What
    // grade_week wrote down is what happened, and a trade in November must not
    // be able to change who won in September.
    frozen,
  );

  // Each man's game hung on him, so the client never has to know about NFL
  // teams at all.
  for (const row of rows) {
    for (const side of [row.home, row.away]) {
      if (side) side.game = byTeam[side.team] ?? null;
    }
  }

  /**
   * One starter, as the model needs him.
   *
   * The score has to come from player_scores rather than from the entry: an
   * entry's `points` is its projection before the slate starts, which is what
   * the board is arranged on, and banking that would have every side finish
   * the week exactly on its projection with a 50% chance of winning.
   *
   * A man with no game this week — a bye, or a free agent nobody has dropped —
   * has nothing more coming, which is what "post" means here.
   *
   * And if the week's fixtures are not known at all, nobody is treated as
   * finished. Not knowing whether a game has been played is not the same as
   * knowing it has, and the wrong one of those empties every projection on the
   * page.
   */
  const knowTheWeek = Object.keys(byTeam).length > 0;
  const playable = (e: (typeof rows)[number]["home"]) =>
    e && {
      points: scores.get(e.name)?.points ?? 0,
      projected: e.projected,
      state: knowTheWeek ? (e.game?.state ?? "post") : ("pre" as const),
    };

  const homeOutlook = outlookOf(rows.map((r) => playable(r.home)));
  const awayOutlook = outlookOf(rows.map((r) => playable(r.away)));
  const isFinal = (fixture?.final && isTheFixture) ?? false;

  return Response.json({
    week,
    scheduled: isTheFixture,
    final: (fixture?.final && isTheFixture) ?? false,
    // Whether the left-hand column is the person reading it. The client used
    // to be able to assume so; now that any two franchises can be laid out, it
    // has to be told.
    mine,
    // "home" is always the left-hand franchise, so the client never has to
    // work out which column is which.
    home: {
      ...left,
      total: totalOf(rows, "home"),
      projected: Math.round(homeOutlook.projected * 10) / 10,
      yetToPlay: homeOutlook.yetToPlay,
      inPlay: homeOutlook.inPlay,
      record: recordOf(left.id),
    },
    away: {
      ...opponent,
      total: totalOf(rows, "away"),
      projected: Math.round(awayOutlook.projected * 10) / 10,
      yetToPlay: awayOutlook.yetToPlay,
      inPlay: awayOutlook.inPlay,
      record: recordOf(opponent.id),
    },
    // Not the share-of-points bar, which reads 100% for a side leading 40-0
    // with everything still to come. See win-probability.ts.
    winProbability: winProbability(homeOutlook, awayOutlook, isFinal),
    rows,
    // A game in progress, rather than "we hold some numbers for this week" —
    // which stayed true from the first kickoff until the next season.
    live: state.live,
    started: state.started,
    weekPhase: state.phase,
    managers: roster,
  });
}
