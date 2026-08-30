import { MEDIA_BUCKET, MAX_VIDEO_BYTES, VIDEO_TYPES, introVideoPath, readableSize } from "@/lib/league-media";
import { isConfigured, serverClient, serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Mints a one-shot URL the commissioner's browser uploads the film to.
 *
 * The file never passes through this server. It could not: a serverless
 * request body is capped at a few megabytes and an intro film is not. So the
 * server does the part that needs the service key — deciding who may upload,
 * and where — and hands back a token that is good for that one path and
 * nothing else.
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

  if (!me?.is_commissioner) {
    return Response.json({ error: "Only the commissioner can set the intro" }, { status: 403 });
  }

  let body: { filename?: unknown; type?: unknown; size?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const type = typeof body.type === "string" ? body.type : "";
  if (!VIDEO_TYPES.includes(type)) {
    return Response.json({ error: "That is not an MP4, WebM or MOV video" }, { status: 400 });
  }

  const size = Number(body.size);
  if (!Number.isFinite(size) || size <= 0) {
    return Response.json({ error: "That file appears to be empty" }, { status: 400 });
  }
  if (size > MAX_VIDEO_BYTES) {
    return Response.json(
      { error: `That film is ${readableSize(size)}. Keep it under ${readableSize(MAX_VIDEO_BYTES)}.` },
      { status: 413 },
    );
  }

  const filename = typeof body.filename === "string" ? body.filename : "intro.mp4";
  const path = introVideoPath(me.league_id, filename);

  const { data, error } = await serviceClient()
    .storage.from(MEDIA_BUCKET)
    .createSignedUploadUrl(path);

  if (error || !data) {
    console.error("[intro-video] could not mint an upload URL", error);
    return Response.json(
      {
        error:
          "Storage is not ready. Run supabase/all-migrations.sql to create the league-media bucket, then try again.",
      },
      { status: 503 },
    );
  }

  return Response.json({ bucket: MEDIA_BUCKET, path: data.path, token: data.token });
}
