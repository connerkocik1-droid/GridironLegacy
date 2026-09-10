import { fetchInjuries } from "@/lib/espn";
import { toHealth } from "@/lib/health";
import { NameIndex } from "@/lib/player-names";
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
  const { data: known, error: readError } = await db
    .from("nfl_players")
    .select("name");

  if (readError) {
    console.error("[cron/health] could not read the player list", readError);
    return Response.json({ error: readError.message }, { status: 500 });
  }

  const index = new NameIndex((known ?? []).map((row: { name: string }) => row.name));

  let entries: { name: string; status: string; detail?: string }[];
  try {
    entries = await fetchInjuries();
  } catch (err) {
    console.error("[cron/health] could not read the injury report", err);
    return Response.json({ error: "The injury report is not reachable" }, { status: 502 });
  }

  const names: string[] = [];
  const statuses: string[] = [];
  const details: string[] = [];
  let unmatched = 0;

  for (const entry of entries) {
    // Being on a list is not a diagnosis: an entry whose word we cannot read
    // is dropped rather than turned into a designation somebody acts on.
    const status = toHealth(entry.status);
    if (status === "active") continue;

    const name = index.lookup(entry.name);
    if (!name) {
      unmatched += 1;
      continue;
    }

    names.push(name);
    statuses.push(status);
    details.push(entry.detail || entry.status || "");
  }

  if (!names.length) {
    // Not an error. A quiet week in June genuinely has nobody on it, and the
    // database refuses to clear anybody on the strength of an empty report
    // either way.
    return Response.json({ reported: 0, changed: 0, unmatched });
  }

  const { data, error } = await db.rpc("sync_player_health", {
    p_names: names,
    p_statuses: statuses,
    p_details: details,
  });

  if (error) {
    console.error("[cron/health] failed", error);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ reported: names.length, changed: data, unmatched });
}
