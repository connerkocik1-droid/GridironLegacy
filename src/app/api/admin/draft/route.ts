import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Start, pause or resume the draft, or move the clock on the pick in hand. */
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
    .select("league_id")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  let body: { state?: unknown; nudgeSeconds?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  // Giving the manager on the clock more time, or taking it back.
  if (body.nudgeSeconds !== undefined) {
    const seconds = Number(body.nudgeSeconds);
    if (!Number.isInteger(seconds) || seconds === 0) {
      return Response.json({ error: "nudgeSeconds must be a whole number" }, { status: 400 });
    }

    const { data, error } = await db.rpc("nudge_clock", {
      p_league_id: me.league_id,
      p_seconds: seconds,
    });

    if (error) {
      return Response.json({ error: error.message }, { status: error.code === "42501" ? 403 : 409 });
    }
    return Response.json(data);
  }

  const state = typeof body.state === "string" ? body.state : "";
  if (!["pending", "running", "paused", "complete"].includes(state)) {
    return Response.json({ error: "Unknown draft state" }, { status: 400 });
  }

  const { data, error } = await db.rpc("set_draft_state", {
    p_league_id: me.league_id,
    p_state: state,
  });

  if (error) {
    return Response.json({ error: error.message }, { status: error.code === "42501" ? 403 : 409 });
  }

  return Response.json(data);
}
