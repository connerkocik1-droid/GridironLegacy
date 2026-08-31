import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const NOT_CONFIGURED = Response.json(
  { error: "The league database is not configured yet." },
  { status: 503 },
);

type Action = "accept" | "decline" | "counter" | "rescind";

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((v): v is string => typeof v === "string" && v.length > 0))];
}

/**
 * Respond to a trade. Accepting when the other side has already accepted
 * executes it, which happens inside execute_trade so the roster moves are
 * atomic and validated against the rosters as they stand right now.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isConfigured()) return NOT_CONFIGURED;

  const { id } = await ctx.params;
  const db = await serverClient();

  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { data: me } = await db
    .from("managers")
    .select("id, slot, league_id")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  let body: { action?: unknown; give?: unknown; get?: unknown; message?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const action = body.action as Action;
  if (
    action !== "accept" &&
    action !== "decline" &&
    action !== "counter" &&
    action !== "rescind"
  ) {
    return Response.json(
      { error: "action must be accept, decline, counter or rescind" },
      { status: 400 },
    );
  }

  const { data: trade } = await db
    .from("trades")
    .select("id, from_manager, to_manager, offer, status, from_accepted, to_accepted, thread")
    .eq("id", id)
    .single();

  if (!trade) return Response.json({ error: "No such trade" }, { status: 404 });

  const isFrom = trade.from_manager === me.id;
  const isTo = trade.to_manager === me.id;
  if (!isFrom && !isTo) return Response.json({ error: "Not your trade" }, { status: 403 });

  if (trade.status === "executed") {
    return Response.json({ error: "This trade is already done" }, { status: 409 });
  }
  if (trade.status === "declined") {
    return Response.json({ error: "This trade was declined" }, { status: 409 });
  }
  if (trade.status === "rescinded") {
    return Response.json({ error: "This offer was withdrawn" }, { status: 409 });
  }

  const thread = Array.isArray(trade.thread) ? trade.thread : [];
  const note = (text: string) => [...thread, { who: me.slot, at: new Date().toISOString(), text }];
  const message = typeof body.message === "string" ? body.message.slice(0, 500) : "";

  if (action === "rescind") {
    // Only your own terms, and only while they are still waiting. Checked here
    // so the manager gets a sentence rather than a constraint violation; the
    // database enforces the same rule for anything that does not come through
    // this route.
    const mineStands = isFrom ? trade.from_accepted : trade.to_accepted;
    const theirsStands = isFrom ? trade.to_accepted : trade.from_accepted;

    if (!mineStands) {
      return Response.json(
        { error: "There is nothing of yours on the table to withdraw" },
        { status: 409 },
      );
    }
    if (theirsStands) {
      return Response.json(
        { error: "They have already accepted. Too late to withdraw." },
        { status: 409 },
      );
    }

    // Only this manager's own flag is written. The other side's is already
    // false, and the database refuses anyone touching a flag that is not
    // theirs even when the value would not change.
    const { error } = await db
      .from("trades")
      .update({
        status: "rescinded",
        ...(isFrom ? { from_accepted: false } : { to_accepted: false }),
        thread: note(message || "Withdrew the offer."),
      })
      .eq("id", id);

    if (error) {
      console.error("[trades] rescind failed", error);
      return Response.json({ error: "Could not withdraw the offer" }, { status: 400 });
    }

    return Response.json({ ok: true, status: "rescinded" });
  }

  if (action === "decline") {
    await db
      .from("trades")
      .update({
        status: "declined",
        from_accepted: false,
        to_accepted: false,
        thread: note(message || "Declined."),
      })
      .eq("id", id);

    return Response.json({ ok: true, status: "declined" });
  }

  if (action === "counter") {
    // A counter swaps the direction of the deal: what they wanted from you is
    // now what you are offering, so the offer is always stored from the
    // proposer's point of view.
    const give = names(body.give);
    const want = names(body.get);
    if (!give.length && !want.length) {
      return Response.json({ error: "A counter needs at least one player" }, { status: 400 });
    }

    const offer = isFrom ? { give, get: want } : { give: want, get: give };

    // The trigger on `trades` voids both acceptances whenever the terms
    // change, so a counter cannot inherit a stale acceptance.
    const { error } = await db
      .from("trades")
      .update({
        offer,
        thread: note(message || "Countered."),
        ...(isFrom ? { from_accepted: true } : { to_accepted: true }),
      })
      .eq("id", id);

    if (error) {
      console.error("[trades] counter failed", error);
      return Response.json({ error: "Counter was not sent" }, { status: 500 });
    }

    return Response.json({ ok: true, status: "countered" });
  }

  // accept
  const { error: acceptError } = await db
    .from("trades")
    .update({
      ...(isFrom ? { from_accepted: true } : { to_accepted: true }),
      status: "agreed",
      thread: note(message || "Accepted."),
    })
    .eq("id", id);

  if (acceptError) {
    console.error("[trades] accept failed", acceptError);
    return Response.json({ error: "Could not record your acceptance" }, { status: 500 });
  }

  const bothAccepted = isFrom ? trade.to_accepted : trade.from_accepted;
  if (!bothAccepted) {
    return Response.json({ ok: true, status: "agreed", executed: false });
  }

  const { data: result, error: execError } = await db.rpc("execute_trade", { p_trade_id: id });

  if (execError) {
    // The rosters moved under the offer, or someone executed it first. The
    // acceptance stands; the message says what actually blocked it.
    console.error("[trades] execute failed", execError);
    return Response.json({ error: execError.message, executed: false }, { status: 409 });
  }

  return Response.json({ ok: true, status: "executed", executed: true, result });
}
