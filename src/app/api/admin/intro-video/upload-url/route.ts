import { MEDIA_BUCKET, VIDEO_TYPES, introVideoPath } from "@/lib/league-media";
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

  // No ceiling of our own. Storage has one — the project's Global file size
  // limit — and it is the only one that can be right, because it is the one
  // that will actually refuse the upload.

  const filename = typeof body.filename === "string" ? body.filename : "intro.mp4";
  const path = introVideoPath(me.league_id, filename);

  const admin = serviceClient();
  const { data, error } = await admin.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);

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

  // signedUrl as well as the token: the browser uploads to it directly so it
  // can watch the bytes go, which the library's own helper cannot report. The
  // token comes too, as the fallback path if that request will not go through.
  return Response.json({
    bucket: MEDIA_BUCKET,
    path: data.path,
    token: data.token,
    signedUrl: data.signedUrl,
  });
}
