import { fetchScoreboard, type Game, type SeasonType } from "@/lib/espn";

export const dynamic = "force-dynamic";

/** ESPN's preseason runs week 1 (Hall of Fame) through week 4. */
const PRESEASON_WEEKS = 4;

/** How far back to look for a slate that has been played. */
const MAX_STEPS_BACK = 5;

/** A slate is worth showing when something on it has actually happened. */
function hasResults(games: Game[]): boolean {
  return games.some((g) => g.state === "in" || g.state === "post");
}

/**
 * The weeks to try, newest first, after `now` turned out to be all fixtures.
 *
 * Walks back through the part of the season ESPN just named, then into the
 * preseason if the regular season has not started — which is exactly the gap
 * at the end of August, where "now" is week 1 of a season nobody has played
 * and the results everyone wants are the preseason's.
 */
function stepsBack(from: { seasonType: SeasonType; week: number }): {
  seasonType: SeasonType;
  week: number;
}[] {
  const out: { seasonType: SeasonType; week: number }[] = [];

  for (let w = from.week - 1; w >= 1; w--) out.push({ seasonType: from.seasonType, week: w });
  if (from.seasonType === 2) {
    for (let w = PRESEASON_WEEKS; w >= 1; w--) out.push({ seasonType: 1, week: w });
  }

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
 * slate that has actually been played, which is what the ticker wants — in
 * the week between the last preseason game and the opener, "now" is a list of
 * fixtures and the results are the preseason's. Naming a `week` or a
 * `seasontype` pins it exactly: `?seasontype=1&week=3` is preseason week
 * three, played or not.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const weekParam = url.searchParams.get("week");
  const week = weekParam ? Number(weekParam) : undefined;

  if (weekParam && !Number.isInteger(week)) {
    return Response.json({ error: "week must be an integer" }, { status: 400 });
  }

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
  const preferResults = url.searchParams.get("prefer") === "results" && seasonType == null;

  try {
    const games = preferResults
      ? await latestPlayed(year)
      : await fetchScoreboard(week, seasonType, year);

    return Response.json(
      {
        games,
        // What came back, which is not always what was asked for.
        week: games[0]?.week ?? week ?? null,
        seasonType: games[0]?.seasonType ?? seasonType ?? null,
        played: hasResults(games),
        fetchedAt: new Date().toISOString(),
      },
      { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" } },
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
