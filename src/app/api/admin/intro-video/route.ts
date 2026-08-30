import { MEDIA_BUCKET } from "@/lib/league-media";
import { isConfigured, serverClient, serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** The commissioner, or an explanation. */
async function commissioner() {
  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return { error: Response.json({ error: "Not signed in" }, { status: 401 }) };

  const { data: me } = await db
    .from("managers")
    .select("league_id, is_commissioner")
    .eq("auth_user_id", user.id)
    .single();

  if (!me?.is_commissioner) {
    return {
      error: Response.json({ error: "Only the commissioner can set the intro" }, { status: 403 }),
    };
  }

  return { db, leagueId: me.league_id };
}

/**
 * Adopts a film the browser has just uploaded.
 *
 * The path is checked against this league's own folder rather than trusted:
 * the browser is telling the server where it put something, and "under my
 * league's prefix" is the whole of what makes that claim safe.
 *
 * The previous film is deleted only once the new address is saved. If anything
 * fails before that, the league still has the intro it had this morning.
 */
export async function POST(req: Request) {
  if (!isConfigured()) {
    return Response.json({ error: "The league database is not configured yet." }, { status: 503 });
  }

  const who = await commissioner();
  if ("error" in who) return who.error;
  const { db, leagueId } = who;

  let body: { path?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const path = typeof body.path === "string" ? body.path : "";
  if (!path.startsWith(`${leagueId}/`) || path.includes("..")) {
    return Response.json({ error: "That file is not this league's" }, { status: 400 });
  }

  const admin = serviceClient();
  const { publicUrl } = admin.storage.from(MEDIA_BUCKET).getPublicUrl(path).data;

  // The browser said it uploaded; this is the server going and looking. A
  // saved address that 404s on draft night is the failure worth spending a
  // request to avoid.
  try {
    const head = await fetch(publicUrl, { method: "HEAD", cache: "no-store" });
    if (!head.ok) {
      return Response.json({ error: "That upload did not arrive. Try again." }, { status: 502 });
    }
  } catch {
    return Response.json({ error: "Could not reach the uploaded file." }, { status: 502 });
  }

  const { data: league } = await db
    .from("leagues")
    .select("settings")
    .eq("id", leagueId)
    .single();

  const settings = { ...(league?.settings ?? {}) };
  const previous = typeof settings.introVideoPath === "string" ? settings.introVideoPath : null;

  settings.introVideo = publicUrl;
  settings.introVideoPath = path;

  const { error } = await db.from("leagues").update({ settings }).eq("id", leagueId);
  if (error) return Response.json({ error: "Could not save the intro video" }, { status: 400 });

  if (previous && previous !== path) {
    // Best effort. A leftover file costs storage; a failed delete must not
    // cost the commissioner the upload that just succeeded.
    await admin.storage.from(MEDIA_BUCKET).remove([previous]);
  }

  return Response.json({ ok: true, introVideo: publicUrl });
}

/** Takes the intro away, and the file with it. */
export async function DELETE() {
  if (!isConfigured()) {
    return Response.json({ error: "The league database is not configured yet." }, { status: 503 });
  }

  const who = await commissioner();
  if ("error" in who) return who.error;
  const { db, leagueId } = who;

  const { data: league } = await db
    .from("leagues")
    .select("settings")
    .eq("id", leagueId)
    .single();

  const settings = { ...(league?.settings ?? {}) };
  const path = typeof settings.introVideoPath === "string" ? settings.introVideoPath : null;

  delete settings.introVideo;
  delete settings.introVideoPath;

  const { error } = await db.from("leagues").update({ settings }).eq("id", leagueId);
  if (error) return Response.json({ error: "Could not clear the intro video" }, { status: 400 });

  // Only files this league uploaded. An address typed in by hand points at
  // somebody else's server and is not ours to delete.
  if (path?.startsWith(`${leagueId}/`)) {
    await serviceClient().storage.from(MEDIA_BUCKET).remove([path]);
  }

  return Response.json({ ok: true });
}
