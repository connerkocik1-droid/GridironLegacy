import { POOL } from "@/data/league-data";
import { normalizeName } from "@/lib/player-names";
import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** The most a queue holds, matching the cap set_draft_queue enforces. */
const LIMIT = 150;

const NOT_CONFIGURED = Response.json(
  { error: "The league database is not configured yet." },
  { status: 503 },
);

/**
 * A manager's draft queue: the players they want, in the order they want them.
 *
 * The table has existed since the draft was built and nothing has ever written
 * to it, which meant the autodraft it feeds had nothing to read and quietly
 * fell through to best-available every time. This is the missing half.
 *
 * Read through the manager's own session, so the row policy on draft_queue is
 * what limits it to their own list rather than a check written here.
 */
export async function GET() {
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

  const { data: rows } = await db
    .from("draft_queue")
    .select("player_name, rank")
    .eq("league_id", me.league_id)
    .eq("manager_id", me.id)
    .order("rank");

  return Response.json({ queue: (rows ?? []).map((r) => r.player_name as string) });
}

/**
 * Replaces the queue with the list the manager has just arranged.
 *
 * A whole-list write rather than add-one and remove-one: a queue is an order,
 * and almost every edit to one renumbers most of it anyway. The database does
 * it in a single transaction, so a reorder cannot half-apply and leave a
 * manager's list in an order they never chose.
 *
 * Names are resolved against the pool before they are sent, so a queue can
 * only ever hold players who exist. A name that resolves to nobody is dropped
 * rather than refused — the alternative is a whole reorder rejected because
 * one row referred to somebody the pool no longer carries.
 */
export async function PUT(req: Request) {
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

  let body: { players?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.players)) {
    return Response.json({ error: "players must be a list of names" }, { status: 400 });
  }
  if (body.players.length > LIMIT) {
    return Response.json({ error: `A queue holds at most ${LIMIT} players` }, { status: 400 });
  }

  // The pool's own spelling, and each player once. A manager who queues
  // somebody already on their list has moved them, not added them twice.
  const byKey = new Map(POOL.map((p) => [normalizeName(p.n), p.n]));
  const seen = new Set<string>();
  const players: string[] = [];

  for (const entry of body.players) {
    if (typeof entry !== "string") continue;
    const name = byKey.get(normalizeName(entry));
    if (!name || seen.has(name)) continue;
    seen.add(name);
    players.push(name);
  }

  const { data, error } = await db.rpc("set_draft_queue", {
    p_league_id: me.league_id,
    p_players: players,
  });

  if (error) return Response.json({ error: error.message }, { status: 400 });

  return Response.json({ ...data, queue: players });
}
