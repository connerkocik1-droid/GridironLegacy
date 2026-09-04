import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Turns autodraft on or off for the signed-in manager.
 *
 * Written through the manager's own session rather than the service key, the
 * same way ready is: the row policy limits it to their own franchise and the
 * column grant from 0033 limits it to this one field, so nothing here has to
 * be trusted to get that right.
 *
 * What the switch means is "do not wait for my clock". A manager who has it on
 * is picked for the moment their turn comes round — from their queue first,
 * and from ADP-and-need after that — rather than costing the other eleven a
 * minute a round for somebody everybody knows is not coming.
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

  let body: { on?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // Explicit both ways: unlike ready, this one is turned off about as often as
  // it is turned on, so there is no direction to assume.
  if (typeof body.on !== "boolean") {
    return Response.json({ error: "on must be true or false" }, { status: 400 });
  }

  const { data, error } = await db
    .from("managers")
    .update({ autodraft: body.on })
    .eq("auth_user_id", user.id)
    .select("id, autodraft")
    .single();

  if (error) return Response.json({ error: "Could not save that" }, { status: 409 });

  return Response.json({ ok: true, autodraft: data.autodraft });
}
