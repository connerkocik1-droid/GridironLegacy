import { isConfigured, serverClient, serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Lets a manager go, keeping their franchise.
 *
 * Two steps, in this order for a reason. release_franchise breaks the sign-in
 * link first, so the moment it returns the departing manager's open browser no
 * longer resolves to a franchise — whatever happens next, they are out.
 *
 * Then the auth account itself goes. That is not tidiness: the address it was
 * created under is derived from the franchise slot, so an account left behind
 * holds the only address the replacement's sign-up can use. If this second
 * step fails the league is still safe, and the sign-up route knows how to
 * adopt an account it finds in the way.
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
    .select("is_commissioner")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });
  if (!me.is_commissioner) {
    return Response.json(
      { error: "Only the commissioner can release a franchise" },
      { status: 403 },
    );
  }

  let body: { managerId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const managerId = typeof body.managerId === "string" ? body.managerId : "";
  if (!managerId) return Response.json({ error: "managerId is required" }, { status: 400 });

  const { data, error } = await db.rpc("release_franchise", { p_manager_id: managerId });

  if (error) {
    return Response.json({ error: error.message }, { status: error.code === "42501" ? 403 : 409 });
  }

  const released = data as { authUserId?: string | null; franchise?: string; was?: string };

  if (released?.authUserId) {
    const { error: gone } = await serviceClient().auth.admin.deleteUser(released.authUserId);
    if (gone) {
      // Worth saying out loud rather than swallowing: the franchise is free
      // either way, and sign-up copes, but somebody should know.
      console.error("[admin/release] the franchise was freed but its old account remains", gone);
    }
  }

  return Response.json(data);
}
