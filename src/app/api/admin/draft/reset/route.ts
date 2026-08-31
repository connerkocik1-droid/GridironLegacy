import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Undoes the draft: empties every roster, redraws the board, closes the room.
 *
 * Commissioner only, and checked in SQL rather than here — this route knows
 * who is signed in, but the rule about who may reset lives with the data it
 * protects, so a second way in cannot miss it.
 */
export async function POST() {
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

  // reset_draft checks this itself, and that check is the one that actually
  // protects the data. This one is here so the route is right on its own terms
  // rather than by way of an error code coming back from somewhere else — a
  // manager who reaches this URL gets a plain answer, and nothing is attempted
  // on their behalf first.
  if (!me.is_commissioner) {
    return Response.json({ error: "Only the commissioner can reset the draft" }, { status: 403 });
  }

  const { data, error } = await db.rpc("reset_draft", { p_league_id: me.league_id });

  if (error) {
    return Response.json({ error: error.message }, { status: error.code === "42501" ? 403 : 409 });
  }

  return Response.json(data);
}
