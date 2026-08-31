import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Marks the signed-in manager ready for the draft, or not.
 *
 * Written through the manager's own session rather than the service key, so
 * the rules that already exist do the work: the row policy limits it to their
 * own franchise, and the column grant from 0017 limits it to this one field.
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

  let body: { ready?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  // Anything but an explicit false means ready; the button is almost always
  // pressed in one direction.
  const ready = body.ready !== false;

  const { data, error } = await db
    .from("managers")
    .update({ ready })
    .eq("auth_user_id", user.id)
    .select("id, ready")
    .single();

  if (error) return Response.json({ error: "Could not save that" }, { status: 409 });

  return Response.json({ ok: true, ready: data.ready });
}
