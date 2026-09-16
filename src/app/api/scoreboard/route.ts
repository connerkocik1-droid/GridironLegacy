import { fetchScoreboard, type Game, type SeasonType } from "@/lib/espn";
import { isConfigured, serverClient } from "@/lib/supabase";
import { currentWeek } from "@/lib/week";

export const dynamic = "force-dynamic";

/** How far back to look for a slate that has been played. */
const MAX_STEPS_BACK = 5;

/** A slate is worth showing when something on it has actually happened. */
function hasResults(games: Game[]): boolean {
  return games.some((g) => g.state === "in" || g.state === "post");
}

/**
 * The weeks to try, newest first, after `now` turned out to be all fixtures.
 *
 * Walks back through the part of the season ESPN just named, and no further.
 *
 * It used to cross into the preseason from regular-season week 1, on the
 * reasoning that in the gap at the end of August the only results anybody had
 * were the preseason's. That reasoning expires the moment week 1 is on the
 * board: on the Wednesday before the opener the ticker was showing August
 * friendlies — teams resting starters, in games nobody in the league has an
 * interest in — instead of the fixtures and kickoff times of the week about to
 * start. A slate of upcoming games with times on it is not a failure to find
 * results; for the week ahead it is the more useful of the two.
 */
export function stepsBack(from: { seasonType: SeasonType; week: number }): {
  seasonType: SeasonType;
  week: number;
}[] {
  const out: { seasonType: SeasonType; week: number }[] = [];
  for (let w = from.week - 1; w >= 1; w--) out.push({ seasonType: from.seasonType, week: w });
  return out.slice(0, MAX_STEPS_BACK);
}

/**
 * The most recent slate that has been played, for a ticker whose job is to
 * show results rather than a column of zeroes.
 *
 * Costs one request in the normal case — a Sunday, or any week already under
 * way — and only walks back when nothing on the current slate has kicked off.
 */
async function latestPlayed(year?: number): Promise<Game[]> {
  const now = await fetchScoreboard(undefined, null, year);
  if (hasResults(now) || !now.length) return now;

  const first = now[0];
  for (const step of stepsBack({ seasonType: first.seasonType, week: first.week })) {
    const games = await fetchScoreboard(step.week, step.seasonType, year);
    if (hasResults(games)) return games;
  }

  // Nothing anywhere has been played. The upcoming slate, with kickoff times,
  // is still the honest answer.
  return now;
}

/**
 * The week's games with live state, proxied through the server so twelve
 * browsers do not hammer ESPN independently and the response can be cached
 * once for everyone.
 *
 * Asked for nothing in particular, it asks ESPN for nothing in particular:
 * whatever is on right now. `?prefer=results` instead returns the most recent
 * slate that has actually been played, which is what the ticker wants on a
 * Monday — but only within the run of games it is already showing, never back
 * across the start of the season. Naming a `week` or a `seasontype` pins it
 * exactly: `?seasontype=1&week=3` is preseason week three, played or not.
 *
 * `?league=1` pins it to the week the league is on instead. That is the answer
 * the ticker and the games page want: a league whose commissioner has not
 * advanced past week one should be looking at week one's football, not at
 * whatever ESPN happens to have live. Falls back to asking ESPN when there is
 * no league to read — signed out, or a database that is not configured — so
 * the board never goes blank over it.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const weekParam = url.searchParams.get("week");
  const week = weekParam ? Number(weekParam) : undefined;

  if (weekParam && !Number.isInteger(week)) {
    return Response.json({ error: "week must be an integer" }, { status: 400 });
  }

  // The week the league is on, which overrides "whatever is live" but never
  // an explicitly named week: asking for a week and being given another is a
  // lie whoever tells it.
  const leagueWeek = weekParam ? null : url.searchParams.get("league") === "1" ? await weekOfLeague() : null;

  const typeParam = url.searchParams.get("seasontype");
  const asked = typeParam ? Number(typeParam) : null;
  if (typeParam && asked !== 1 && asked !== 2 && asked !== 3) {
    return Response.json({ error: "seasontype must be 1, 2 or 3" }, { status: 400 });
  }

  // A week on its own still means the regular season, which is what a caller
  // passing only a week has always meant.
  const seasonType: SeasonType | null =
    asked != null ? (asked as SeasonType) : weekParam ? 2 : null;

  const yearParam = url.searchParams.get("year");
  const year = yearParam ? Number(yearParam) : undefined;
  if (yearParam && !Number.isInteger(year)) {
    return Response.json({ error: "year must be an integer" }, { status: 400 });
  }

  // Only meaningful when no particular week was named; asking for a week and
  // then being given a different one would be a lie.
  const preferResults =
    url.searchParams.get("prefer") === "results" && seasonType == null && leagueWeek == null;

  try {
    const games = preferResults
      ? await latestPlayed(year)
      : await fetchScoreboard(
          week ?? leagueWeek?.week,
          seasonType ?? (leagueWeek ? 2 : null),
          year ?? leagueWeek?.season,
        );

    return Response.json(
      {
        games,
        // What came back, which is not always what was asked for.
        week: games[0]?.week ?? week ?? null,
        seasonType: games[0]?.seasonType ?? seasonType ?? null,
        played: hasResults(games),
        fetchedAt: new Date().toISOString(),
      },
      {
        headers: {
          // A league-pinned board is one league's answer, so it is never put in
          // a cache twelve other leagues read from.
          "cache-control": leagueWeek
            ? "private, no-store"
            : "public, s-maxage=30, stale-while-revalidate=60",
        },
      },
    );
  } catch (err) {
    // ESPN is undocumented and unreliable; a failure degrades to an empty
    // board rather than breaking every page that reads it.
    console.error("[scoreboard] ESPN unavailable", err);
    return Response.json(
      {
        games: [],
        week: null,
        seasonType: null,
        played: false,
        error: "Live scores are unavailable right now.",
        fetchedAt: null,
      },
      { status: 200 },
    );
  }
}


/**
 * The week the signed-in manager's league is on, and the season it is playing.
 *
 * Null for anybody who is not signed in, and for a database that is not
 * configured — the board falls back to ESPN's own idea of now rather than
 * refusing, because a scoreboard is worth showing to somebody signed out.
 */
async function weekOfLeague(): Promise<{ week: number; season: number } | null> {
  if (!isConfigured()) return null;

  try {
    const db = await serverClient();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return null;

    const { data: me } = await db
      .from("managers")
      .select("league_id")
      .eq("auth_user_id", user.id)
      .single();
    if (!me) return null;

    const { data: league } = await db
      .from("leagues")
      .select("season")
      .eq("id", me.league_id)
      .single();
    if (!league?.season) return null;

    return { week: await currentWeek(db, me.league_id), season: Number(league.season) };
  } catch (err) {
    console.warn("[scoreboard] could not read the league's week", err);
    return null;
  }
}
