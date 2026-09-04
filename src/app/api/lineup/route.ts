import { fetchInjuries } from "@/lib/espn";
import { toHealth } from "@/lib/health";
import { freshenWeek } from "@/lib/live-refresh";
import { normalizeName } from "@/lib/player-names";
import { weekFrom } from "@/lib/week";
import { player } from "@/lib/roster";
import { formatStatLine } from "@/lib/scoring";
import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const NOT_CONFIGURED = Response.json(
  { error: "The league database is not configured yet." },
  { status: 503 },
);

/**
 * A manager's roster, in a league where there is no lineup to set.
 *
 * This used to be the two halves of a lineup editor: what is saved, and a way
 * to save something else. Best ball has neither. The whole roster plays, the
 * starting slots fill themselves from whoever is scoring, and they go on
 * refilling until the last game ends — so all this hands back is the roster
 * and enough about the week for the page to say which of those three things
 * is happening.
 */
export async function GET(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;

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

  const week = await weekFrom(req, db, me.league_id);
  if (week == null) {
    return Response.json({ error: "week must be an integer" }, { status: 400 });
  }

  const { data: league } = await db
    .from("leagues")
    .select("season, settings")
    .eq("id", me.league_id)
    .single();

  const state = await freshenWeek(db, me.league_id, league?.season, week);

  const { data: slots } = await db
    .from("roster_slots")
    .select("player_name, lineup_slot")
    .eq("manager_id", me.id);

  // Injured reserve is the only thing lineup_slot still means. A stashed
  // player is on the roster but out of the week entirely — he cannot fill a
  // slot and he does not count against the roster limit.
  const stashed = (slots ?? [])
    .filter((s) => s.lineup_slot === "IR")
    .map((s) => s.player_name);
  const roster = (slots ?? [])
    .filter((s) => s.lineup_slot !== "IR")
    .map((s) => s.player_name);

  const { data: scoreRows } = await db
    .from("player_scores")
    .select("player_name, points, stat_line, stats")
    .eq("league_id", me.league_id)
    .eq("week", week)
    .in("player_name", [...roster, ...stashed]);

  // Whether this week is already in the books, which is what turns a lineup
  // that is still moving into one that is not.
  const { data: fixture } = await db
    .from("matchups")
    .select("final")
    .eq("league_id", me.league_id)
    .eq("week", week)
    .or(`home_manager.eq.${me.id},away_manager.eq.${me.id}`)
    .maybeSingle();

  return Response.json({
    week,
    me,
    settings: league?.settings ?? null,
    roster,
    injuredReserve: stashed,
    live: state.live,
    started: state.started,
    weekPhase: state.phase,
    final: fixture?.final ?? false,
    scores: Object.fromEntries(
      (scoreRows ?? []).map((r) => {
        const position =
          player(r.player_name)?.p ?? (r.stats as { position?: string } | null)?.position ?? "";
        const line = r.stats ? formatStatLine(r.stats, position) : "";
        return [
          r.player_name,
          { points: Number(r.points), statLine: line || r.stat_line || "" },
        ];
      }),
    ),
  });
}

/**
 * Puts one of your own on injured reserve, or brings him back.
 *
 * The only roster decision left, and the one best ball does not make for you:
 * a man who tore something in October should not cost a spot until March.
 *
 * Whether he is hurt is checked here rather than in the database, because the
 * injury report is ESPN's and never reaches Postgres. If it cannot be read,
 * this refuses rather than waving the stash through — an unchecked reserve is
 * two extra roster spots for anybody who notices.
 */
export async function POST(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  let payload: { player?: unknown; ir?: unknown };
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const name = typeof payload.player === "string" ? payload.player.trim() : "";
  if (!name) return Response.json({ error: "player is required" }, { status: 400 });
  if (typeof payload.ir !== "boolean") {
    return Response.json({ error: "ir must be true or false" }, { status: 400 });
  }

  if (payload.ir) {
    let hurt: boolean;
    try {
      const report = await fetchInjuries();
      const key = normalizeName(name);
      // Everybody on the report is on it for a reason, so an entry whose word
      // we do not recognise still counts — the check is "is he on it at all".
      hurt = report.some((entry) => normalizeName(entry.name) === key);
      if (hurt) {
        const entry = report.find((e) => normalizeName(e.name) === key)!;
        // Questionable is not a reason to stash somebody for the season.
        hurt = toHealth(entry.status) !== "questionable";
      }
    } catch {
      return Response.json(
        { error: "The injury report is unavailable right now — try again shortly." },
        { status: 503 },
      );
    }

    if (!hurt) {
      return Response.json(
        {
          error: `${name} is not on the injury report. Injured reserve is for players ruled out, not rested ones.`,
        },
        { status: 400 },
      );
    }
  }

  const { data, error } = await db.rpc("set_injured_reserve", {
    p_player: name,
    p_on: payload.ir,
  });

  if (error) {
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json(data ?? { ok: true });
}

/**
 * There is nothing to save.
 *
 * Kept rather than deleted so that a browser left open across the change, or
 * anything else still holding the old shape, is told what happened instead of
 * getting a 405 and a shrug.
 */
export async function PUT() {
  return Response.json(
    {
      error:
        "This league is best ball — there is no lineup to set. The highest scorers fill the slots by themselves.",
    },
    { status: 410 },
  );
}
