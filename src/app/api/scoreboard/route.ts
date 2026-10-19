import { EspnBackoffError, fetchScoreboard, type Game, type SeasonType } from "@/lib/espn";
import { mirroredSlate } from "@/lib/scoreboard-mirror";
import { isConfigured, serverClient, serviceClient } from "@/lib/supabase";
import { currentWeek } from "@/lib/week";

export const dynamic = "force-dynamic";

/** How far back to look for a slate that has been played. */
const MAX_STEPS_BACK = 5;

/**
 * How long one answer from ESPN serves everybody who asks for the same slate.
 *
 * The ticker and the games page each ask every thirty seconds, from every
 * phone that has them open, and the league-pinned board is private — no CDN
 * sits in front of it. So every one of those went to ESPN, a dozen phones on a
 * Sunday being a dozen requests a poll, and in week 3 ESPN started answering
 * 403. One request per slate per fifteen seconds, shared by everybody on this
 * server — and by everybody arriving while it is still in flight — is what the
 * pages actually need.
 */
const FRESH_MS = 15_000;
const recent = new Map<string, { at: number; games: Game[] }>();
const pending = new Map<string, Promise<Game[]>>();

async function shared(key: string, load: () => Promise<Game[]>): Promise<Game[]> {
  const hit = recent.get(key);
  if (hit && Date.now() - hit.at < FRESH_MS) return hit.games;

  const inFlight = pending.get(key);
  if (inFlight) return inFlight;

  const request = load()
    .then((games) => {
      recent.set(key, { at: Date.now(), games });
      // A handful of slates are ever asked for; this only stops a stream of
      // odd ones growing the map without end.
      if (recent.size > 64) {
        const oldest = recent.keys().next().value;
        if (oldest !== undefined) recent.delete(oldest);
      }
      return games;
    })
    .finally(() => pending.delete(key));

  pending.set(key, request);
  return request;
}

/**
 * The slate from the league's own mirror of it, for when ESPN will not answer.
 * Null when there is no database to ask or nothing in it for the week.
 */
async function fromMirror(want: {
  season: number | null;
  week: number | null;
  seasonType: SeasonType | null;
}): Promise<{ games: Game[]; asOf: string | null } | null> {
  if (!isConfigured()) return null;
  try {
    // The NFL's schedule and scores, which are nobody's secret: read with the
    // service key so a signed-out visitor's board falls back as well.
    return await mirroredSlate(serviceClient(), want);
  } catch (err) {
    console.warn("[scoreboard] the mirror could not stand in either", err);
    return null;
  }
}

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

  const target = {
    week: week ?? leagueWeek?.week,
    seasonType: seasonType ?? (leagueWeek ? (2 as SeasonType) : null),
    year: year ?? leagueWeek?.season,
  };
  const key = JSON.stringify([
    preferResults ? "results" : "slate",
    target.week ?? null,
    target.seasonType ?? null,
    target.year ?? null,
  ]);

  try {
    const games = await shared(key, () =>
      preferResults
        ? latestPlayed(year)
        : fetchScoreboard(target.week, target.seasonType, target.year),
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
    // A refusal we are already waiting out is expected, and not worth an
    // error on every poll; anything else is.
    if (err instanceof EspnBackoffError) console.warn("[scoreboard]", err.message);
    else console.error("[scoreboard] ESPN unavailable", err);

    // The last scores the league heard, marked as such, rather than a board
    // that empties in the middle of a Sunday. Never cached anywhere shared: a
    // stale answer must not be handed out as a fresh one.
    const fallback = await fromMirror({
      season: target.year ?? null,
      week: target.week ?? null,
      seasonType: target.seasonType ?? null,
    });
    if (fallback) {
      return Response.json(
        {
          games: fallback.games,
          week: fallback.games[0]?.week ?? target.week ?? null,
          seasonType: fallback.games[0]?.seasonType ?? target.seasonType ?? null,
          played: hasResults(fallback.games),
          fetchedAt: fallback.asOf,
          stale: true,
        },
        { headers: { "cache-control": "private, no-store" } },
      );
    }

    // ESPN is undocumented and unreliable; with nothing to stand in for it a
    // failure degrades to an empty board rather than breaking every page.
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
