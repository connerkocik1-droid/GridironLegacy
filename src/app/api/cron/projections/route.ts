import { optimalLineup } from "@/lib/start-rate";
import { proj } from "@/lib/roster";
import { serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * What the week looks like before it is played.
 *
 * The one of the four that cannot live in the database: a projection comes
 * from the static player pool the application carries, and the database has
 * never seen a projection in its life. So the arithmetic is here, and only the
 * sentence goes into the outbox.
 *
 * Best ball, which is the whole point of saying it at all. In a league where
 * the lineup sets itself, "you project 118" is a fact about the roster rather
 * than a nudge to go and change it — and the interesting half is the number
 * beside it, which is what the other fellow projects.
 *
 * Runs on a Thursday. Deduplicated by week, so running it every day until
 * kickoff sends one message.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const leagueId = process.env.LEAGUE_ID;
  if (!leagueId) return Response.json({ error: "LEAGUE_ID is not set" }, { status: 500 });

  const db = serviceClient();

  const [{ data: league }, { data: fixtures }, { data: slots }, { data: managers }] =
    await Promise.all([
      db.from("leagues").select("settings").eq("id", leagueId).single(),
      db
        .from("matchups")
        .select("week, home_manager, away_manager, final")
        .eq("league_id", leagueId)
        .order("week"),
      db
        .from("roster_slots")
        .select("manager_id, player_name, lineup_slot")
        .eq("league_id", leagueId),
      db.from("managers").select("id, franchise").eq("league_id", leagueId),
    ]);

  // The week worth projecting is the next one to be settled — the same
  // question the home page asks, answered the same way, so a notification and
  // the page it opens never disagree about which week it is.
  const next = (fixtures ?? []).find((f) => !f.final);
  if (!next) return Response.json({ ok: true, week: null, queued: 0 });

  const franchiseOf = new Map((managers ?? []).map((m) => [m.id, m.franchise]));
  const settings = (league?.settings ?? null) as { starters?: Record<string, number> } | null;

  /** What a roster is worth at its best arrangement, before a ball is kicked. */
  const projected = (managerId: string | null): number => {
    if (!managerId) return 0;

    const roster = (slots ?? [])
      // The reserve is outside the eighteen and cannot score, so it cannot
      // project either.
      .filter((s) => s.manager_id === managerId && s.lineup_slot !== "IR")
      .map((s) => s.player_name);

    const values = new Map(roster.map((name) => [name, proj(name)]));
    const starters = optimalLineup(roster, settings, values);

    let total = 0;
    for (const name of starters.keys()) total += values.get(name) ?? 0;
    return total;
  };

  const week = next.week as number;
  let queued = 0;

  for (const fixture of (fixtures ?? []).filter((f) => f.week === week)) {
    const home = projected(fixture.home_manager);
    const away = projected(fixture.away_manager);

    const sides = [
      { me: fixture.home_manager, mine: home, them: away, other: fixture.away_manager },
      { me: fixture.away_manager, mine: away, them: home, other: fixture.home_manager },
    ];

    for (const side of sides) {
      if (!side.me) continue;

      const gap = side.mine - side.them;
      const opponent = franchiseOf.get(side.other ?? "") ?? "your opponent";

      const { data, error } = await db.rpc("enqueue_push", {
        p_manager_id: side.me,
        p_kind: "projections",
        p_title: `Week ${week}: you project ${side.mine.toFixed(1)}`,
        // Favourite or not, said as a margin rather than as odds. A projection
        // is a rough number and dressing it as a percentage gives it an
        // authority it has not earned.
        p_body:
          Math.abs(gap) < 1
            ? `Level with ${opponent}.`
            : gap > 0
              ? `${gap.toFixed(1)} ahead of ${opponent}.`
              : `${Math.abs(gap).toFixed(1)} behind ${opponent}.`,
        p_href: `/matchup?week=${week}`,
        p_dedupe: `projections:w${week}`,
      });

      if (error) console.warn("[cron/projections] could not queue", error.message);
      else if (data) queued += 1;
    }
  }

  return Response.json({ ok: true, week, queued });
}
