import { POOL } from "@/data/league-data";
import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const NOT_CONFIGURED = Response.json(
  { error: "The league database is not configured yet." },
  { status: 503 },
);

/** The board, the clock, and who is on it. */
export async function GET() {
  if (!isConfigured()) return NOT_CONFIGURED;

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { data: me } = await db
    .from("managers")
    .select("id, slot, franchise, league_id, is_commissioner")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  const { data: league } = await db
    .from("leagues")
    .select("id, settings, draft_state, current_pick, pick_started_at, draft_at")
    .eq("id", me.league_id)
    .single();
  if (!league) return Response.json({ error: "League not found" }, { status: 404 });

  const { data: picks } = await db
    .from("draft_picks")
    .select("overall, round, manager_id, player_name, picked_at")
    .eq("league_id", me.league_id)
    .order("overall");

  const { data: managers } = await db
    .from("managers")
    .select("id, slot, franchise")
    .eq("league_id", me.league_id);

  const { data: rostered } = await db
    .from("roster_slots")
    .select("player_name")
    .eq("league_id", me.league_id);

  const taken = new Set((rostered ?? []).map((r) => r.player_name));
  const available = POOL.filter((p) => !taken.has(p.n))
    .slice(0, 200)
    .map((p) => ({
      name: p.n,
      position: p.p,
      team: p.t,
      adp: p.adp,
      posRank: p.posRank,
      bye: p.bye,
    }));

  const onTheClock = (picks ?? []).find((p) => p.overall === league.current_pick) ?? null;
  const pickSeconds = Number(league.settings?.pickSeconds ?? 90);

  return Response.json({
    me,
    league: {
      state: league.draft_state,
      currentPick: league.current_pick,
      // The clock is the server's. Clients count down from this instant so
      // twelve browsers cannot drift apart and skip someone.
      pickStartedAt: league.pick_started_at,
      pickSeconds,
      serverNow: new Date().toISOString(),
      draftAt: league.draft_at,
      // How many rounds get the full-screen reveal. Past these the board just
      // updates, because ten seconds a pick stops being a thrill by round four.
      cinematicRounds: Number(league.settings?.cinematicRounds ?? 3),
    },
    onTheClock,
    myTurn: onTheClock?.manager_id === me.id,
    picks: picks ?? [],
    managers: managers ?? [],
    available,
  });
}

/** Make the pick that is on the clock. */
export async function POST(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { data: me } = await db
    .from("managers")
    .select("id, league_id")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  let body: { player?: unknown; forManager?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const playerName = typeof body.player === "string" ? body.player : "";
  if (!playerName) return Response.json({ error: "player is required" }, { status: 400 });

  const { data, error } = await db.rpc("make_pick", {
    p_league_id: me.league_id,
    p_player_name: playerName,
    p_manager_id: typeof body.forManager === "string" ? body.forManager : null,
  });

  if (error) {
    // Two managers can click the same player in the same second. The loser
    // gets told cleanly rather than seeing a duplicate appear.
    const conflict = error.code === "23505" || error.message.includes("already");
    return Response.json({ error: error.message }, { status: conflict ? 409 : 400 });
  }

  return Response.json(data);
}
