import { fetchScoreboard } from "@/lib/espn";

export const dynamic = "force-dynamic";

/**
 * The week's games with live state, proxied through the server so twelve
 * browsers do not hammer ESPN independently and the response can be cached
 * once for everyone.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const weekParam = url.searchParams.get("week");
  const week = weekParam ? Number(weekParam) : undefined;

  if (weekParam && !Number.isInteger(week)) {
    return Response.json({ error: "week must be an integer" }, { status: 400 });
  }

  try {
    const games = await fetchScoreboard(week);
    return Response.json(
      { games, fetchedAt: new Date().toISOString() },
      { headers: { "cache-control": "public, s-maxage=30, stale-while-revalidate=60" } },
    );
  } catch (err) {
    // ESPN is undocumented and unreliable; a failure degrades to an empty
    // board rather than breaking every page that reads it.
    console.error("[scoreboard] ESPN unavailable", err);
    return Response.json(
      { games: [], error: "Live scores are unavailable right now.", fetchedAt: null },
      { status: 200 },
    );
  }
}
