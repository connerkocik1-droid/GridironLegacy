import { fetchScoreboard, type SeasonType } from "@/lib/espn";

export const dynamic = "force-dynamic";

/**
 * The week's games with live state, proxied through the server so twelve
 * browsers do not hammer ESPN independently and the response can be cached
 * once for everyone.
 *
 * Asked for nothing in particular, it asks ESPN for nothing in particular:
 * whatever is on right now, which through August is the preseason. Naming a
 * `week` or a `seasontype` pins it instead — `?seasontype=1&week=3` is
 * preseason week three.
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

  try {
    const games = await fetchScoreboard(week, seasonType, year);
    return Response.json(
      {
        games,
        // What came back, which is not always what was asked for.
        week: games[0]?.week ?? week ?? null,
        seasonType: games[0]?.seasonType ?? seasonType ?? null,
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
        error: "Live scores are unavailable right now.",
        fetchedAt: null,
      },
      { status: 200 },
    );
  }
}
