import { currentManager } from "@/lib/session";
import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const NOT_CONFIGURED = Response.json(
  { error: "The league database is not configured yet." },
  { status: 503 },
);

/** The players this manager is keeping an eye on. */
export async function GET() {
  if (!isConfigured()) return NOT_CONFIGURED;

  const me = await currentManager();
  if (!me) return Response.json({ error: "Not signed in" }, { status: 401 });

  const db = await serverClient();
  // The row policy already limits this to the caller's own, so there is no
  // filter here to get wrong: the policy is the filter.
  const { data } = await db
    .from("watchlist")
    .select("player_name, added_at")
    .order("added_at", { ascending: false });

  return Response.json({ players: (data ?? []).map((r) => r.player_name) });
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
