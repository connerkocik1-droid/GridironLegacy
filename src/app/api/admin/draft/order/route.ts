import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Sets the order franchises pick in, and redraws the board to match.
 *
 * The order is a list of franchise slots. Shuffling is done here rather than
 * in SQL so the commissioner sees the result and can shuffle again before
 * anyone else does — a lottery nobody can re-roll is a lottery, and this is
 * not meant to be one.
 */
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
    .select("league_id, is_commissioner")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });
  if (!me.is_commissioner) {
    return Response.json({ error: "Only the commissioner can set the draft order" }, { status: 403 });
  }

  let body: { order?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const order = Array.isArray(body.order) ? body.order.filter((s) => typeof s === "string") : null;
  if (!order?.length) return Response.json({ error: "order is required" }, { status: 400 });

  const { data, error } = await db.rpc("set_draft_order", {
    p_league_id: me.league_id,
    p_slots: order,
  });

  if (error) {
    return Response.json({ error: error.message }, { status: error.code === "42501" ? 403 : 409 });
  }

  return Response.json(data);
}
