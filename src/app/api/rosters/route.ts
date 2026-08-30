import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** One manager's roster. RLS limits this to managers in the caller's league. */
export async function GET(req: Request) {
  if (!isConfigured()) {
    return Response.json({ error: "The league database is not configured yet." }, { status: 503 });
  }

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const managerId = new URL(req.url).searchParams.get("manager");
  if (!managerId) return Response.json({ error: "manager is required" }, { status: 400 });

  const { data } = await db
    .from("roster_slots")
    .select("player_name, lineup_slot, acquired")
    .eq("manager_id", managerId)
    .order("player_name");

  return Response.json({
    players: (data ?? []).map((r) => r.player_name),
    slots: data ?? [],
  });
}
