import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Every franchise's crest in the league, by manager id.
 *
 * Kept out of the payloads that already carry managers, on purpose. The draft
 * board polls five times a minute and the schedule once a minute; a picture
 * ridden along on those would be re-sent hundreds of times a night for
 * something that changes about once a season. This is asked for once per page
 * instead, and the browser is told it may keep it for a minute.
 */
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
    .select("league_id")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  // RLS already limits this to the signed-in manager's own league; the filter
  // is here so a misread policy cannot turn into every league's crests.
  const { data } = await db
    .from("team_logos")
    .select("manager_id, image")
    .eq("league_id", me.league_id);

  const logos: Record<string, string> = {};
  for (const row of data ?? []) {
    if (typeof row.image === "string") logos[row.manager_id] = row.image;
  }

  return Response.json(
    { logos },
    // Private: these belong to one league. A minute is long enough to cover a
    // page's worth of components and short enough that a new crest appears
    // while people are still talking about it.
    { headers: { "cache-control": "private, max-age=60" } },
  );
}
