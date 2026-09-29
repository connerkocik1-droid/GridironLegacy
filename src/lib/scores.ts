import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Every score row a league holds, however many that is.
 *
 * Three routes — the home page, the rankings board and the free agents list —
 * each asked player_scores for a whole league and then picked out what they
 * wanted in JavaScript. That read is bigger than it looks: the pool is nine
 * hundred and forty-four men and the mirror scores all of them whether or not
 * anybody owns them, so a league passes a thousand rows early in its second
 * week.
 *
 * A thousand is where PostgREST stops. It does not fail and it does not say
 * anything — it returns the first thousand rows and a 200. With no order by,
 * the rows that fall off the end are broadly the newest, which is why the home
 * page's score sat behind the matchup screen's all afternoon and why the
 * rankings board lost players' totals as the season went on. The matchup
 * screen was right the whole time because it asks for one week and one pair of
 * rosters.
 *
 * So the read is paged. The page size is the server's own limit rather than a
 * number of ours: asking for more than it allows is how this went wrong, and
 * a page that comes back short is the end of the data.
 */

/** PostgREST's default ceiling, and the page size that cannot be truncated. */
const PAGE = 1000;

/** Enough pages for a full season of a nine-hundred-man pool, and then some. */
const MAX_PAGES = 40;

export interface ScoreRow {
  player_name: string;
  points: number;
  week: number;
  stat_line?: string | null;
  stats?: Record<string, number> | null;
}

/**
 * Reads player_scores for a league, a page at a time.
 *
 * `columns` is the caller's own select list, because the three callers want
 * different shapes and the widest of them — the rankings board's stats blob —
 * is the one nobody else should pay for.
 *
 * `week` narrows it where the caller only wants one, which is both cheaper and
 * the thing that would have avoided all of this.
 */
export async function readScores(
  db: SupabaseClient,
  leagueId: string,
  columns: string,
  week?: number,
): Promise<ScoreRow[]> {
  const out: ScoreRow[] = [];

  for (let page = 0; page < MAX_PAGES; page++) {
    let q = db.from("player_scores").select(columns).eq("league_id", leagueId);
    if (week != null) q = q.eq("week", week);

    // Ordered, so the pages are a partition of the data rather than three
    // overlapping arbitrary slices. Without this the planner is free to
    // return the same row twice across two pages and miss another entirely.
    const { data, error } = await q
      .order("week")
      .order("player_name")
      .range(page * PAGE, page * PAGE + PAGE - 1);

    if (error) {
      console.error("[scores] could not read a page", error.message);
      break;
    }

    const rows = (data ?? []) as unknown as ScoreRow[];
    out.push(...rows);

    // Short page: that was the last of it.
    if (rows.length < PAGE) return out;
  }

  // Past the guard. Better a season that is missing its last pages than a
  // route that pages for ever, and it says so rather than going quiet.
  console.error(`[scores] stopped at ${MAX_PAGES} pages for league ${leagueId}`);
  return out;
}
