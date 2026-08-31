import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Wipes the season: rosters, results, the schedule, the board, the log.
 *
 * Keeps the league itself — who is in it and what their franchises are called
 * — unless `releaseFranchises` is asked for, which hands the unclaimed ones
 * back too. Commissioner only, checked in SQL.
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

  // As with the draft reset: reset_league enforces this where it counts, and
  // this is the route answering for itself instead of relaying somebody
  // else's error.
  if (!me.is_commissioner) {
    return Response.json({ error: "Only the commissioner can reset the league" }, { status: 403 });
  }

  // A missing body means the plain reset; releasing franchises is opt-in and
  // must be asked for explicitly.
  let body: { releaseFranchises?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const { data, error } = await db.rpc("reset_league", {
    p_league_id: me.league_id,
    p_release_franchises: body.releaseFranchises === true,
  });

  if (error) {
    return Response.json({ error: error.message }, { status: error.code === "42501" ? 403 : 409 });
  }

  return Response.json(data);
}
