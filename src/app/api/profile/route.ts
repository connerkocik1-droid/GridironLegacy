import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * A manager's own profile. Renaming the franchise, for now.
 *
 * The write goes through the manager's own session, not the service key, so
 * the column grants from 0010 are what decide what may change: a manager may
 * write `franchise`, and the request cannot reach `pin_hash`, `auth_user_id`
 * or `is_commissioner` however it is shaped.
 */
export async function PATCH(req: Request) {
  if (!isConfigured()) {
    return Response.json({ error: "The league database is not configured yet." }, { status: 503 });
  }

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body: { franchise?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const franchise = typeof body.franchise === "string" ? body.franchise.trim() : "";
  if (!franchise) return Response.json({ error: "Give your team a name" }, { status: 400 });
  if (franchise.length > 40) {
    return Response.json({ error: "That name is too long — 40 characters at most" }, { status: 400 });
  }

  const { data, error } = await db
    .from("managers")
    .update({ franchise })
    .eq("auth_user_id", user.id)
    .select("id, slot, franchise")
    .single();

  if (error) {
    return Response.json({ error: "Could not save that name" }, { status: 409 });
  }

  return Response.json({ ok: true, franchise: data.franchise });
}
