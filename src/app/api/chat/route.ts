import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** How much of the conversation a page holds. Older than this is scrolled to. */
const PAGE = 60;

const NOT_CONFIGURED = Response.json(
  { error: "The league database is not configured yet." },
  { status: 503 },
);

/**
 * The league's conversation.
 *
 * Everything here goes through the manager's own session rather than the
 * service key, so the row policies from 0035 are the whole of the security: a
 * manager reads their own league, posts as themselves, and deletes their own —
 * or anybody's, if they are the commissioner. Nothing in this file is trusted
 * to get that right, which is why nothing in this file checks it.
 */
export async function GET(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { data: me } = await db
    .from("managers")
    .select("id, league_id, is_commissioner")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  // Anything after a message the caller already holds. A conversation that is
  // polled every few seconds should cost one row when one thing was said, not
  // sixty rows to discover that.
  const since = new URL(req.url).searchParams.get("since");

  let query = db
    .from("messages")
    .select("id, manager_id, body, created_at")
    .order("created_at", { ascending: false })
    .limit(PAGE);

  if (since && !Number.isNaN(Date.parse(since))) query = query.gt("created_at", since);

  const [{ data: rows }, { data: managers }] = await Promise.all([
    query,
    db
      .from("managers")
      .select("id, name, franchise")
      .eq("league_id", me.league_id),
  ]);

  // Oldest first, which is how a conversation reads. The query takes the
  // newest sixty and this puts them back in order.
  const messages = [...(rows ?? [])].reverse().map((m) => ({
    id: m.id as string,
    managerId: m.manager_id as string,
    body: m.body as string,
    at: m.created_at as string,
    mine: m.manager_id === me.id,
  }));

  return Response.json({
    me: { id: me.id, isCommissioner: me.is_commissioner },
    managers: (managers ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      franchise: m.franchise,
    })),
    messages,
  });
}

/** Say something. */
export async function POST(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { data: me } = await db
    .from("managers")
    .select("id, league_id")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  let payload: { body?: unknown };
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const body = typeof payload.body === "string" ? payload.body.trim() : "";
  if (!body) return Response.json({ error: "Say something first" }, { status: 400 });
  if (body.length > 1000) {
    return Response.json({ error: "That is longer than a message — 1000 characters at most" }, { status: 400 });
  }

  const { data, error } = await db
    .from("messages")
    .insert({ league_id: me.league_id, manager_id: me.id, body })
    .select("id, manager_id, body, created_at")
    .single();

  if (error) {
    // The rate guard raises its own sentence, which is more use to somebody
    // holding a key down than "could not post".
    const tooFast = error.code === "54000" || error.message.includes("lot of messages");
    return Response.json(
      { error: tooFast ? error.message : "Could not post that" },
      { status: tooFast ? 429 : 400 },
    );
  }

  return Response.json({
    ok: true,
    message: {
      id: data.id,
      managerId: data.manager_id,
      body: data.body,
      at: data.created_at,
      mine: true,
    },
  });
}

/** Take one back, or take one down. */
export async function DELETE(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return Response.json({ error: "id is required" }, { status: 400 });

  // No ownership test here on purpose. The delete policy allows a manager's
  // own and the commissioner's anything, so a request for somebody else's
  // deletes no rows and the count says so.
  const { data, error } = await db.from("messages").delete().eq("id", id).select("id");

  if (error) return Response.json({ error: "Could not delete that" }, { status: 400 });
  if (!data?.length) {
    return Response.json({ error: "That is not yours to delete" }, { status: 403 });
  }

  return Response.json({ ok: true });
}
