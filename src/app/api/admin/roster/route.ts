import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Every player in the league and who holds him, for the commissioner's
 * correction tool.
 *
 * Read with the caller's own session rather than the service key: roster_slots
 * is already readable league-wide, so nothing here needs privileges the
 * commissioner does not have as an ordinary manager. The privilege lives in
 * the function that MOVES a player, which is where it belongs.
 */
export async function GET() {
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
    .select("id, league_id, is_commissioner")
    .eq("auth_user_id", user.id)
    .single();
  if (!me?.is_commissioner) {
    return Response.json({ error: "Only the commissioner can do this" }, { status: 403 });
  }

  const [{ data: slots }, { data: managers }] = await Promise.all([
    db
      .from("roster_slots")
      .select("player_name, manager_id, lineup_slot")
      .eq("league_id", me.league_id)
      .order("player_name"),
    db.from("managers").select("id, franchise, slot").eq("league_id", me.league_id).order("slot"),
  ]);

  const by = new Map((managers ?? []).map((m) => [m.id, m]));

  return Response.json({
    managers: managers ?? [],
    players: (slots ?? []).map((s) => ({
      name: s.player_name,
      managerId: s.manager_id,
      franchise: by.get(s.manager_id)?.franchise ?? "Unknown",
      slot: s.lineup_slot,
    })),
  });
}

/** Moves a player, or releases him. The database decides whether that is allowed. */
export async function POST(req: Request) {
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
    .select("id, league_id")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  let body: { player?: unknown; to?: unknown; reason?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const playerName = typeof body.player === "string" ? body.player.trim() : "";
  if (!playerName) return Response.json({ error: "Name the player" }, { status: 400 });

  // An empty destination is a release, which is a decision rather than an
  // omission — so it has to be sent explicitly as null.
  const to = typeof body.to === "string" && body.to ? body.to : null;
  const reason = typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;

  const { data, error } = await db.rpc("commissioner_move_player", {
    p_league_id: me.league_id,
    p_player: playerName,
    p_to: to,
    p_reason: reason,
  });

  if (error) {
    return Response.json(
      { error: error.message },
      { status: error.code === "42501" ? 403 : 400 },
    );
  }
  return Response.json(data);
}
