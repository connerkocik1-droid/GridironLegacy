import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** The manager's own inbox, newest first, with the unread count. */
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
    .select("id, league_id")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  // RLS already limits this to the caller's own, so there is no filter here to
  // get wrong: the policy is the filter.
  const { data } = await db
    .from("notices")
    .select("id, kind, body, href, read_at, created_at")
    .order("created_at", { ascending: false })
    .limit(30);

  const notices = data ?? [];

  return Response.json({
    unread: notices.filter((n) => n.read_at == null).length,
    notices,
  });
}

/** Marks everything read. */
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
    .select("league_id")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  const { data, error } = await db.rpc("read_notices", { p_league_id: me.league_id });
  if (error) return Response.json({ error: "Could not mark them read" }, { status: 400 });
  return Response.json({ ok: true, read: data });
}
