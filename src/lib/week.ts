import type { serverClient } from "./supabase";

type Db = Awaited<ReturnType<typeof serverClient>>;

/**
 * The week the league is on.
 *
 * Not today's date: a league can be graded late, and every page should follow
 * the league rather than the calendar. The rule is the one the home page has
 * always used — the first fixture still to be settled, or the last one played
 * once the season is over.
 *
 * Written down here because three routes were each defaulting to week one when
 * nobody passed a week, which is right for exactly seven days a year. A
 * manager opening their roster in November was reading September.
 */
export async function currentWeek(db: Db, leagueId: string): Promise<number> {
  const { data } = await db
    .from("matchups")
    .select("week, final")
    .eq("league_id", leagueId)
    .order("week");

  const fixtures = data ?? [];
  const unfinished = fixtures.find((f) => !f.final);
  return Number(unfinished?.week ?? fixtures.at(-1)?.week ?? 1);
}

/**
 * The week a request asked for, or the one the league is on.
 *
 * Returns null for a week that is not a number, so the caller answers with a
 * 400 rather than quietly showing something else.
 */
export async function weekFrom(
  req: Request,
  db: Db,
  leagueId: string,
): Promise<number | null> {
  const asked = new URL(req.url).searchParams.get("week");
  if (asked == null || asked === "") return currentWeek(db, leagueId);

  const week = Number(asked);
  return Number.isInteger(week) ? week : null;
}
