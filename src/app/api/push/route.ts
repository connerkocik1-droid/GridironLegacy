import { isPushConfigured } from "@/lib/push";
import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const NOT_CONFIGURED = Response.json(
  { error: "The league database is not configured yet." },
  { status: 503 },
);

/** The four, and nothing else. A body naming another key changes nothing. */
const KINDS = ["scores", "recap", "injuries", "projections"] as const;
type Kind = (typeof KINDS)[number];

const COLUMN: Record<Kind, string> = {
  scores: "push_scores",
  recap: "push_recap",
  injuries: "push_injuries",
  projections: "push_projections",
};

async function currentManager(db: Awaited<ReturnType<typeof serverClient>>) {
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;

  const { data } = await db
    .from("managers")
    .select("id, push_scores, push_recap, push_injuries, push_projections")
    .eq("auth_user_id", user.id)
    .single();

  return data;
}

/**
 * What this manager has asked for, and whether this browser is signed up.
 *
 * The two are separate on purpose. The preferences are the manager's and
 * follow them between devices; the subscription is this browser's, and a
 * manager who wants injuries on their phone and nothing on their laptop is
 * describing two devices rather than two sets of preferences.
 */
export async function GET(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;

  const db = await serverClient();
  const me = await currentManager(db);
  if (!me) return Response.json({ error: "Not signed in" }, { status: 401 });

  const endpoint = new URL(req.url).searchParams.get("endpoint");

  // Asked by endpoint rather than listed, because the list is every device
  // this manager owns and the page only ever needs to know about the one it
  // is running on.
  let subscribed = false;
  if (endpoint) {
    const { data } = await db
      .from("push_subscriptions")
      .select("endpoint")
      .eq("endpoint", endpoint)
      .maybeSingle();
    subscribed = data != null;
  }

  const { count } = await db
    .from("push_subscriptions")
    .select("endpoint", { count: "exact", head: true })
    .eq("manager_id", me.id);

  return Response.json({
    configured: isPushConfigured(),
    // The browser needs this to subscribe at all, and it is a public key —
    // its whole job is to be handed out.
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null,
    subscribed,
    devices: count ?? 0,
    prefs: {
      scores: me.push_scores,
      recap: me.push_recap,
      injuries: me.push_injuries,
      projections: me.push_projections,
    },
  });
}

/** This browser saying it will accept notifications. */
export async function POST(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;

  const db = await serverClient();

  let body: { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  const p256dh = typeof body.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const auth = typeof body.keys?.auth === "string" ? body.keys.auth : "";

  if (!endpoint || !p256dh || !auth) {
    return Response.json({ error: "A subscription needs an endpoint and both keys" }, { status: 400 });
  }

  const { error } = await db.rpc("subscribe_push", {
    p_endpoint: endpoint,
    p_p256dh: p256dh,
    p_auth: auth,
  });

  if (error) {
    console.error("[push] subscribe failed", error);
    const status = /Not signed in/.test(error.message) ? 401 : 400;
    return Response.json({ error: error.message }, { status });
  }

  return Response.json({ ok: true });
}

/** Turning them off on this browser. Their preferences are left alone. */
export async function DELETE(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;

  const db = await serverClient();
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  if (!endpoint) return Response.json({ error: "Which endpoint?" }, { status: 400 });

  const { error } = await db.rpc("forget_push", { p_endpoint: endpoint });
  if (error) {
    console.error("[push] forget failed", error);
    return Response.json({ error: error.message }, { status: 400 });
  }

  return Response.json({ ok: true });
}

/** Changing which of the four are wanted. */
export async function PATCH(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;

  const db = await serverClient();
  const me = await currentManager(db);
  if (!me) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  // Only the four, and only as booleans. Building the patch from a fixed list
  // rather than from the body means an extra key in the request is an extra
  // key in the request and not an update to a column nobody meant to expose.
  const patch: Record<string, boolean> = {};
  for (const kind of KINDS) {
    if (typeof body[kind] === "boolean") patch[COLUMN[kind]] = body[kind] as boolean;
  }

  if (!Object.keys(patch).length) {
    return Response.json({ error: "Nothing to change" }, { status: 400 });
  }

  const { error } = await db.from("managers").update(patch).eq("id", me.id);
  if (error) {
    console.error("[push] preferences failed", error);
    return Response.json({ error: "Could not save that" }, { status: 400 });
  }

  return Response.json({ ok: true, ...patch });
}
