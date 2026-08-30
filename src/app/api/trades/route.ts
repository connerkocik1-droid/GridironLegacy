import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const NOT_CONFIGURED = Response.json(
  { error: "The league database is not configured yet." },
  { status: 503 },
);

/** The signed-in manager, or null. */
async function currentManager(db: Awaited<ReturnType<typeof serverClient>>) {
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;

  const { data } = await db
    .from("managers")
    .select("id, slot, franchise, league_id")
    .eq("auth_user_id", user.id)
    .single();

  return data;
}

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === "string" && v.length > 0))];
}

/** Every trade this manager is party to, newest first. */
export async function GET() {
  if (!isConfigured()) return NOT_CONFIGURED;

  const db = await serverClient();
  const me = await currentManager(db);
  if (!me) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { data: trades } = await db
    .from("trades")
    .select(
      "id, from_manager, to_manager, offer, status, from_accepted, to_accepted, thread, created_at, executed_at",
    )
    .or(`from_manager.eq.${me.id},to_manager.eq.${me.id}`)
    .order("created_at", { ascending: false });

  const { data: managers } = await db
    .from("managers")
    .select("id, slot, franchise")
    .eq("league_id", me.league_id);

  const { data: block } = await db
    .from("trade_block")
    .select("player_name, manager_id")
    .eq("league_id", me.league_id);

  return Response.json({
    me,
    managers: managers ?? [],
    block: block ?? [],
    trades: (trades ?? []).map((t) => ({
      ...t,
      // Say whose turn it is without the client re-deriving the rule.
      incoming: t.to_manager === me.id,
      awaitingMe: t.to_manager === me.id ? !t.to_accepted : !t.from_accepted,
    })),
  });
}

/** Propose a trade to another manager. */
export async function POST(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;

  const db = await serverClient();
  const me = await currentManager(db);
  if (!me) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body: { to?: unknown; give?: unknown; get?: unknown; message?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const to = typeof body.to === "string" ? body.to : "";
  const give = names(body.give);
  const want = names(body.get);

  if (!to) return Response.json({ error: "Pick a trade partner" }, { status: 400 });
  if (to === me.id) return Response.json({ error: "You cannot trade with yourself" }, { status: 400 });
  if (!give.length && !want.length) {
    return Response.json({ error: "An offer needs at least one player" }, { status: 400 });
  }

  const { data: partner } = await db
    .from("managers")
    .select("id")
    .eq("id", to)
    .eq("league_id", me.league_id)
    .single();
  if (!partner) return Response.json({ error: "No such manager in this league" }, { status: 404 });

  // Both sides must actually own what they are being asked to send, or the
  // offer is meaningless before anyone reads it.
  const { data: owned } = await db
    .from("roster_slots")
    .select("player_name, manager_id")
    .eq("league_id", me.league_id)
    .in("player_name", [...give, ...want]);

  const ownerOf = new Map((owned ?? []).map((r) => [r.player_name, r.manager_id]));

  const notMine = give.filter((n) => ownerOf.get(n) !== me.id);
  if (notMine.length) {
    return Response.json({ error: `Not on your roster: ${notMine.join(", ")}` }, { status: 400 });
  }

  const notTheirs = want.filter((n) => ownerOf.get(n) !== to);
  if (notTheirs.length) {
    return Response.json(
      { error: `Not on their roster: ${notTheirs.join(", ")}` },
      { status: 400 },
    );
  }

  const message = typeof body.message === "string" ? body.message.slice(0, 500) : "";
  const thread = [
    {
      who: me.slot,
      at: new Date().toISOString(),
      text: message || "Offer sent.",
    },
  ];

  const { data: trade, error } = await db
    .from("trades")
    .insert({
      league_id: me.league_id,
      from_manager: me.id,
      to_manager: to,
      offer: { give, get: want },
      status: "open",
      // Proposing is accepting your own terms; the partner still has to agree.
      from_accepted: true,
      to_accepted: false,
      thread,
    })
    .select("id")
    .single();

  if (error) {
    console.error("[trades] insert failed", error);
    return Response.json({ error: "Offer was not sent" }, { status: 500 });
  }

  return Response.json({ ok: true, id: trade.id });
}
