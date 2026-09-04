import { currentManager } from "@/lib/session";
import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const NOT_CONFIGURED = Response.json(
  { error: "The league database is not configured yet." },
  { status: 503 },
);

/**
 * The players this manager is keeping an eye on, and who holds them.
 *
 * Ownership is the question a watchlist is really asking. A player you are
 * watching is a player you are deciding about, and "can I have him" is
 * answered by whether anybody already does — so the answer comes back with
 * the list rather than being three more requests away.
 */
export async function GET() {
  if (!isConfigured()) return NOT_CONFIGURED;

  const me = await currentManager();
  if (!me) return Response.json({ error: "Not signed in" }, { status: 401 });

  const db = await serverClient();

  // The row policy already limits the watchlist to the caller's own, so there
  // is no filter here to get wrong: the policy is the filter.
  const [{ data: watched }, { data: rostered }, { data: managers }, { data: wire }] =
    await Promise.all([
      db.from("watchlist").select("player_name, added_at").order("added_at", { ascending: false }),
      db.from("roster_slots").select("player_name, manager_id").eq("league_id", me.league_id),
      db.from("managers").select("id, slot, franchise").eq("league_id", me.league_id),
      db.from("waiver_wire").select("player_name, clears_at").eq("league_id", me.league_id),
    ]);

  const holder = new Map((rostered ?? []).map((r) => [r.player_name, r.manager_id as string]));
  const byId = new Map((managers ?? []).map((m) => [m.id as string, m]));
  const clears = new Map((wire ?? []).map((w) => [w.player_name, w.clears_at as string]));

  const players = (watched ?? []).map((r) => {
    const ownerId = holder.get(r.player_name);
    const owner = ownerId ? byId.get(ownerId) : undefined;

    return {
      name: r.player_name,
      addedAt: r.added_at,
      owner: owner
        ? { id: ownerId, slot: owner.slot, franchise: owner.franchise, mine: ownerId === me.id }
        : null,
      // On the wire means he is not claimable yet, which is a different thing
      // from being owned and matters just as much.
      clearsAt: clears.get(r.player_name) ?? null,
    };
  });

  return Response.json({
    // The bare names first, because that is what the news filter reads and it
    // should not have to know about any of the rest of this.
    players: players.map((p) => p.name),
    watching: players,
  });
}

/** Starts watching a player. Watching one already watched is not an error. */
export async function POST(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;

  const me = await currentManager();
  if (!me) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body: { player?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const player = typeof body.player === "string" ? body.player.trim() : "";
  if (!player) return Response.json({ error: "Name the player" }, { status: 400 });

  const db = await serverClient();
  const { error } = await db
    .from("watchlist")
    .upsert(
      { manager_id: me.id, player_name: player, league_id: me.league_id },
      { onConflict: "manager_id,player_name" },
    );

  if (error) return Response.json({ error: "Could not watch that player" }, { status: 400 });
  return Response.json({ ok: true, watching: player });
}

/** Stops watching one. */
export async function DELETE(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;

  const me = await currentManager();
  if (!me) return Response.json({ error: "Not signed in" }, { status: 401 });

  const player = new URL(req.url).searchParams.get("player");
  if (!player) return Response.json({ error: "Name the player" }, { status: 400 });

  const db = await serverClient();
  // manager_id is named as well as the policy requiring it: the policy stops
  // somebody else's row being deleted, and this stops a bug here doing it.
  const { error } = await db
    .from("watchlist")
    .delete()
    .eq("manager_id", me.id)
    .eq("player_name", player);

  if (error) return Response.json({ error: "Could not stop watching" }, { status: 400 });
  return Response.json({ ok: true });
}
