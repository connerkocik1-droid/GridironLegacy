import { fetchInjuries } from "@/lib/espn";
import { syncReport } from "@/lib/injury-sync";
import { serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Puts the injury report into the database.
 *
 * Fitness has always lived at ESPN and reached the browser, which was enough
 * while it only decided whether to draw a badge. It is not enough now: the
 * reserve is a league rule — who may sit outside the eighteen — and league
 * rules live in the database, because every function there is granted to
 * `authenticated` and a browser holding a session can call them directly.
 *
 * Nightly, and more often would be better: designations move on Wednesday and
 * Friday practice reports and again ninety minutes before kickoff. Nightly is
 * what the rest of the app's cron does and is enough for a rule measured in
 * months.
 *
 * A failed fetch writes nothing, and sync_player_health refuses an empty
 * report for the same reason — an outage at ESPN looks exactly like a league
 * in perfect health, and acting on it would activate every stashed player in
 * the league on the strength of somebody else's bad afternoon.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const db = serviceClient();

  // The report is keyed by ESPN's spelling and the database by the league's,
  // and they disagree often enough to matter — a suffix, an accent, a man who
  // goes by his middle name. Same index the scorer matches box scores with, so
  // a name that scores correctly is a name that can be stashed correctly.
  let entries: { name: string; status: string; detail?: string }[];
  try {
    entries = await fetchInjuries();
  } catch (err) {
    console.error("[cron/health] could not read the injury report", err);
    return Response.json({ error: "The injury report is not reachable" }, { status: 502 });
  }

  // The same writer the stash route uses. It used to be written out here and
  // nowhere else, which was fine until a second caller needed it — and a
  // second copy of "which entries are worth writing" is a second answer.
  const { changed, unmatched, reported } = await syncReport(db, entries);

  if (!reported) {
    // Not an error. A quiet week in June genuinely has nobody on it, and the
    // database refuses to clear anybody on the strength of an empty report
    // either way.
    return Response.json({ reported: 0, changed: 0, unmatched });
  }

  // And tell the managers who hold them. Reads the report as it now stands
  // rather than what changed, because the dedupe key carries the designation:
  // a man who is questionable for three weeks is announced once, and the
  // morning he is downgraded to out is a second message. Not fatal — the
  // report being in the database is the part that matters.
  const leagueId = process.env.LEAGUE_ID;
  let queued = 0;
  if (leagueId) {
    const news = await db.rpc("push_injury_news", { p_league_id: leagueId });
    if (news.error) console.warn("[cron/health] injury news", news.error.message);
    else queued = news.data ?? 0;
  }

  return Response.json({ reported, changed, unmatched, queued });
}
