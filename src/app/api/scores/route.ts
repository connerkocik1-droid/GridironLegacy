import { freshenWeek } from "@/lib/live-refresh";
import { player } from "@/lib/roster";
import { formatStatLine } from "@/lib/scoring";
import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Live fantasy points for the signed-in manager's roster.
 *
 * A player with no row has not played yet — which is not the same as having
 * scored nothing, and the two must never be shown the same way.
 */
export async function GET(req: Request) {
  if (!isConfigured()) {
    return Response.json({ error: "The league database is not configured yet." }, { status: 503 });
  }

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { data: me } = await db
    .from("managers")
    .select("id, slot, franchise, league_id")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  const weekParam = new URL(req.url).searchParams.get("week");
  const week = weekParam ? Number(weekParam) : 1;
  if (!Number.isInteger(week)) {
    return Response.json({ error: "week must be an integer" }, { status: 400 });
  }

  const { data: league } = await db
    .from("leagues")
    .select("season")
    .eq("id", me.league_id)
    .single();

  const state = await freshenWeek(db, me.league_id, league?.season, week);

  const { data: slots } = await db
    .from("roster_slots")
    .select("player_name, lineup_slot")
    .eq("manager_id", me.id);

  const roster = slots ?? [];

  const { data: scoreRows } = await db
    .from("player_scores")
    .select("player_name, points, stat_line, stats, updated_at")
    .eq("league_id", me.league_id)
    .eq("week", week)
    .in(
      "player_name",
      roster.map((r) => r.player_name),
    );

  return Response.json({
    week,
    me,
    live: state.live,
    started: state.started,
    weekPhase: state.phase,
    roster,
    scores: Object.fromEntries(
      (scoreRows ?? []).map((r) => {
        // The position decides the wording, and the roster is what knows it —
        // a tight end reads as targets and catches, a back as carries.
        const position = player(r.player_name)?.p ?? "";
        const line = r.stats ? formatStatLine(r.stats, position) : "";

        return [
          r.player_name,
          {
            points: Number(r.points),
            statLine: line || r.stat_line || "",
            updatedAt: r.updated_at,
          },
        ];
      }),
    ),
  });
}
