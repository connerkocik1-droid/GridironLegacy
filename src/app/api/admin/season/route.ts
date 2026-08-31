import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Whether this season is finished, and who won it. */
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
    .select("league_id, is_commissioner")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  const { data: league } = await db
    .from("leagues")
    .select("season")
    .eq("id", me.league_id)
    .single();

  const { data: champion } = await db
    .from("league_champions")
    .select("franchise")
    .eq("league_id", me.league_id)
    .eq("season", league?.season ?? 0)
    .maybeSingle();

  return Response.json({
    season: league?.season ?? null,
    champion: champion?.franchise ?? null,
    isCommissioner: me.is_commissioner === true,
  });
}

/** Rolls the league into the next season. The database decides whether it may. */
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

  // p_season is left out deliberately: skipping a year is a thing the function
  // supports and the office does not offer, because there is no way to do it
  // by accident from a SQL console and every way to do it by accident here.
  const { data, error } = await db.rpc("roll_season", { p_league_id: me.league_id });

  if (error) {
    return Response.json({ error: error.message }, { status: error.code === "42501" ? 403 : 400 });
  }
  return Response.json(data);
}
