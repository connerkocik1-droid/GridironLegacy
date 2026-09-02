import { after } from "next/server";
import { maybeRefreshScores, weekState, type WeekState } from "./live";
import { serviceClient, type serverClient } from "./supabase";

const IDLE: WeekState = { phase: "upcoming", started: false, live: false };

/**
 * What a page needs to know about the week, and a nudge to go and find out
 * more if what we hold has gone stale.
 *
 * Every page that shows a score calls this. It returns immediately with the
 * week's state as the mirror has it, and schedules the pull for after the
 * response has gone out, so no manager ever waits on ESPN to see a page.
 *
 * The scores in *this* response are therefore up to one throttle window old.
 * That is the deal, and it is a good one: the alternative is either a page
 * that hangs on somebody else's API or a cron fine enough to be live, which
 * means running all night in February to catch thirteen Sundays in the autumn.
 * A manager watching a game refreshes anyway, and the refresh after the one
 * that triggered the pull carries the new number.
 */
export async function freshenWeek(
  db: Awaited<ReturnType<typeof serverClient>>,
  leagueId: string,
  season: number | null | undefined,
  week: number | null | undefined,
): Promise<WeekState> {
  if (season == null || week == null) return IDLE;

  const state = await weekState(db, season, week);

  after(async () => {
    try {
      await maybeRefreshScores(serviceClient(), leagueId, state, week);
    } catch (err) {
      // A page that renders is worth more than a score that is twenty seconds
      // newer, so this never reaches the response.
      console.error("[live] background refresh failed", err);
    }
  });

  return state;
}
