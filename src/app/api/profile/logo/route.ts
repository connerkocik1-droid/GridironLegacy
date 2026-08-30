import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** What the table's own constraint allows, checked here so the error is plain. */
const MAX_CHARS = 300_000;
const ALLOWED = ["data:image/webp;base64,", "data:image/png;base64,", "data:image/jpeg;base64,"];

/** Every manager's crest, for drawing the league. */
export async function GET() {
  if (!isConfigured()) return Response.json({ logos: {} });

  const db = await serverClient();
  const { data } = await db.from("team_logos").select("manager_id, image");

  const logos: Record<string, string> = {};
  for (const row of data ?? []) logos[row.manager_id] = row.image;

  return Response.json({ logos });
}

/**
 * Sets the signed-in manager's crest.
 *
 * The browser has already squared and shrunk the picture; this checks that
 * what arrived is actually a small image and not a ten-megabyte photograph
 * wearing the right prefix. The row is written through the manager's own
 * session, so the policy on team_logos is what stops anyone writing somebody
 * else's.
 */
export async function PUT(req: Request) {
  if (!isConfigured()) {
    return Response.json({ error: "The league database is not configured yet." }, { status: 503 });
  }

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body: { image?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const image = typeof body.image === "string" ? body.image : "";

  if (!ALLOWED.some((prefix) => image.startsWith(prefix))) {
    return Response.json({ error: "That is not a PNG, JPEG or WebP image" }, { status: 400 });
  }
  if (image.length > MAX_CHARS) {
    return Response.json({ error: "That picture is too large" }, { status: 413 });
  }

  const { data: me } = await db
    .from("managers")
    .select("id, league_id")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  const { error } = await db
    .from("team_logos")
    .upsert(
      { manager_id: me.id, league_id: me.league_id, image, updated_at: new Date().toISOString() },
      { onConflict: "manager_id" },
    );

  if (error) return Response.json({ error: "Could not save that picture" }, { status: 409 });

  return Response.json({ ok: true });
}

/** Takes the crest off again, back to the initials. */
export async function DELETE() {
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
    .select("id")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  await db.from("team_logos").delete().eq("manager_id", me.id);

  return Response.json({ ok: true });
}
