import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** What the table's own constraint allows, checked here so the error is plain. */
const MAX_CHARS = 300_000;
const ALLOWED = ["data:image/webp;base64,", "data:image/png;base64,", "data:image/jpeg;base64,"];
const SCOPES = ["cfb", "nfl"];

/**
 * Every school and team crest the league has uploaded, for the commissioner's
 * desk and the public Pylon Report page alike. CFB and the Pylon 50 share the
 * 'cfb' scope — a school keyed once lights up on both boards.
 */
export async function GET() {
  if (!isConfigured()) return Response.json({ cfb: {}, nfl: {} });

  const db = await serverClient();
  const { data } = await db.from("report_logos").select("scope, abbr, image");

  const logos: { cfb: Record<string, string>; nfl: Record<string, string> } = { cfb: {}, nfl: {} };
  for (const row of data ?? []) {
    if (row.scope === "cfb" || row.scope === "nfl") {
      const scope: "cfb" | "nfl" = row.scope;
      logos[scope][row.abbr] = row.image;
    }
  }

  return Response.json(logos);
}

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
    return { error: Response.json({ error: "Only the commissioner can set a report crest" }, { status: 403 }) };
  }

  return { db, leagueId: me.league_id };
}

/** Sets one school or team's crest. */
export async function PUT(req: Request) {
  if (!isConfigured()) {
    return Response.json({ error: "The league database is not configured yet." }, { status: 503 });
  }

  const who = await commissioner();
  if ("error" in who) return who.error;
  const { db, leagueId } = who;

  let body: { scope?: unknown; abbr?: unknown; image?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const scope = typeof body.scope === "string" ? body.scope : "";
  if (!SCOPES.includes(scope)) {
    return Response.json({ error: "scope must be cfb or nfl" }, { status: 400 });
  }

  const abbr = typeof body.abbr === "string" ? body.abbr.trim().toUpperCase().slice(0, 4) : "";
  if (!abbr) return Response.json({ error: "abbr is required" }, { status: 400 });

  const image = typeof body.image === "string" ? body.image : "";
  if (!ALLOWED.some((prefix) => image.startsWith(prefix))) {
    return Response.json({ error: "That is not a PNG, JPEG or WebP image" }, { status: 400 });
  }
  if (image.length > MAX_CHARS) {
    return Response.json({ error: "That picture is too large" }, { status: 413 });
  }

  const { error } = await db
    .from("report_logos")
    .upsert(
      { league_id: leagueId, scope, abbr, image, updated_at: new Date().toISOString() },
      { onConflict: "league_id,scope,abbr" },
    );

  if (error) return Response.json({ error: "Could not save that crest" }, { status: 409 });

  return Response.json({ ok: true });
}

/** Takes one school or team's crest off, back to the abbreviation tile. */
export async function DELETE(req: Request) {
  if (!isConfigured()) {
    return Response.json({ error: "The league database is not configured yet." }, { status: 503 });
  }

  const who = await commissioner();
  if ("error" in who) return who.error;
  const { db } = who;

  let body: { scope?: unknown; abbr?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const scope = typeof body.scope === "string" ? body.scope : "";
  const abbr = typeof body.abbr === "string" ? body.abbr.trim().toUpperCase().slice(0, 4) : "";
  if (!SCOPES.includes(scope) || !abbr) {
    return Response.json({ error: "scope and abbr are required" }, { status: 400 });
  }

  await db.from("report_logos").delete().eq("scope", scope).eq("abbr", abbr);

  return Response.json({ ok: true });
}
