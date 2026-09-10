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
 *
 * Anybody's roster, not only the caller's. `?manager=` names whose, and
 * defaults to the signed-in one. Nothing here was ever private: rosters have
 * been readable league-wide since the first migration, because a league where
 * you cannot see what the other eleven teams hold is a league where you cannot
 * make a trade, judge a waiver claim, or work out why you lost. The route
 * simply had no way to ask.
 */
/**
 * The eighteen, worked out the way roster_capacity() works it out: the
 * starting slots plus the bench. Mirrored here only so the page can say what
 * the limit is — the database is still the one that enforces it.
 */
function capacityOf(settings: unknown): number {
  const s = (settings ?? {}) as { starters?: Record<string, number>; bench?: number };
  const starters = Object.values(s.starters ?? {}).reduce((sum, n) => sum + Number(n || 0), 0);
  return starters + Number(s.bench ?? 0);
}

export async function GET(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { data: me } = await db
    .from("managers")
    .select("id, slot, name, franchise, league_id")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  // Whose roster. RLS already refuses anybody outside the caller's league, so
  // a manager id from another league reads as one that does not exist.
  const askedFor = new URL(req.url).searchParams.get("manager");
  const { data: asked } = askedFor
    ? await db
        .from("managers")
        .select("id, slot, name, franchise, league_id")
        .eq("id", askedFor)
        .eq("league_id", me.league_id)
        .maybeSingle()
    : { data: null };

  if (askedFor && !asked) {
    return Response.json({ error: "No such franchise in this league" }, { status: 404 });
  }

  const subject = asked ?? me;
  const mine = subject.id === me.id;

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
    .eq("manager_id", subject.id);

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

  // Who may sit outside the eighteen, straight from the injury report the
  // cron writes. Sent for the whole roster rather than only the reserve,
  // because the button that offers to stash somebody has to know before he is
  // stashed — and read here rather than from the browser's own copy of the
  // report so the page and the database cannot disagree about a rule the
  // database is the one enforcing.
  const { data: eligible } = await db
    .from("nfl_players")
    .select("name, injury_status")
    .in("name", [...roster, ...stashed]);

  const irEligible = Object.fromEntries(
    (eligible ?? []).map((r: { name: string; injury_status: string | null }) => [
      r.name,
      r.injury_status === "ir" || r.injury_status === "suspended",
    ]),
  );

  // Stashed players the report says are fit again. They count against the
  // eighteen where they sit, so a manager holding one may be over the limit
  // and has to drop somebody before adding anybody.
  const irReturns = stashed.filter((name) => !irEligible[name]);

  // Whether this week is already in the books, which is what turns a lineup
  // that is still moving into one that is not.
  const { data: fixture } = await db
    .from("matchups")
    .select("final")
    .eq("league_id", me.league_id)
    .eq("week", week)
    .or(`home_manager.eq.${subject.id},away_manager.eq.${subject.id}`)
    .maybeSingle();

  return Response.json({
    week,
    // "me" is whose roster this is, so the board never has to work out which
    // franchise it is drawing. `mine` says whether the reader owns it, which
    // is what decides whether anything on the page can be pressed.
    me: subject,
    mine,
    settings: league?.settings ?? null,
    roster,
    injuredReserve: stashed,
    irEligible,
    irReturns,
    // The reserve's size, and how much of the eighteen is spoken for. Both
    // computed the way the database computes them, so a button that will be
    // refused is not offered.
    irLimit: Number((league?.settings as { ir?: number } | null)?.ir ?? 0),
    rosterCount: roster.length + irReturns.length,
    rosterLimit: capacityOf(league?.settings ?? null),
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
