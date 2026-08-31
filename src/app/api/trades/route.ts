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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Pick ids from a request body, deduplicated and shaped like ids. */
function ids(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === "string" && UUID.test(v)))];
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

  // Picks are property too, and the desk cannot offer what it cannot see.
  const [{ data: picks }, { data: league }] = await Promise.all([
    db
      .from("draft_pick_assets")
      .select("id, season, round, slot, manager_id, origin_manager")
      .eq("league_id", me.league_id)
      .order("season")
      .order("round")
      .order("slot"),
    db.from("leagues").select("season, inaugural_season").eq("id", me.league_id).single(),
  ]);

  const inaugural = league?.inaugural_season ?? league?.season ?? null;

  return Response.json({
    me,
    managers: managers ?? [],
    block: block ?? [],
    inauguralSeason: inaugural,
    picks: (picks ?? []).map((p) => ({
      ...p,
      // The same rule the database enforces, so the desk can grey out what it
      // already knows will be refused rather than letting somebody build an
      // offer that cannot execute.
      tradeable: inaugural == null ? false : p.season > inaugural,
    })),
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

  let body: {
    to?: unknown;
    give?: unknown;
    get?: unknown;
    givePicks?: unknown;
    getPicks?: unknown;
    message?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const to = typeof body.to === "string" ? body.to : "";
  const give = names(body.give);
  const want = names(body.get);
  const givePicks = ids(body.givePicks);
  const getPicks = ids(body.getPicks);

  if (!to) return Response.json({ error: "Pick a trade partner" }, { status: 400 });
  if (to === me.id) return Response.json({ error: "You cannot trade with yourself" }, { status: 400 });
  if (!give.length && !want.length && !givePicks.length && !getPicks.length) {
    return Response.json(
      { error: "An offer needs at least one player or pick" },
      { status: 400 },
    );
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

  // Picks get the same treatment as players: held by the side promising them,
  // and for a season that is actually for sale. execute_trade checks again on
  // the way through, because an offer can sit for days.
  if (givePicks.length || getPicks.length) {
    const [{ data: held }, { data: league }] = await Promise.all([
      db
        .from("draft_pick_assets")
        .select("id, season, manager_id")
        .eq("league_id", me.league_id)
        .in("id", [...givePicks, ...getPicks]),
      db.from("leagues").select("season, inaugural_season").eq("id", me.league_id).single(),
    ]);

    const rows = held ?? [];
    const holderOf = new Map(rows.map((p) => [p.id, p.manager_id]));

    if (givePicks.some((id) => holderOf.get(id) !== me.id)) {
      return Response.json({ error: "You do not hold one of those picks" }, { status: 400 });
    }
    if (getPicks.some((id) => holderOf.get(id) !== to)) {
      return Response.json({ error: "They do not hold one of those picks" }, { status: 400 });
    }

    const inaugural = league?.inaugural_season ?? league?.season;
    const locked = rows.filter((p) => inaugural == null || p.season <= inaugural);
    if (locked.length) {
      const seasons = [...new Set(locked.map((p) => p.season))].sort().join(", ");
      return Response.json(
        { error: `Picks for the ${seasons} draft cannot be traded` },
        { status: 400 },
      );
    }
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
      offer: { give, get: want, givePicks, getPicks },
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
