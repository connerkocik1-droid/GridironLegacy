import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const NOT_CONFIGURED = Response.json(
  { error: "The league database is not configured yet." },
  { status: 503 },
);

/**
 * A manager's say on somebody else's trade.
 *
 * Everything that decides anything happens in cast_trade_vote: who may vote,
 * whether the window is open, and whether this was the vote that settled it.
 * This route is the doorway, not the rule — the same call from a console gets
 * the same answer.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isConfigured()) return NOT_CONFIGURED;

  const { id } = await ctx.params;
  const db = await serverClient();

  let body: { vote?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const vote = body.vote;
  if (vote !== "veto" && vote !== "approve") {
    return Response.json({ error: "vote must be veto or approve" }, { status: 400 });
  }

  const { data, error } = await db.rpc("cast_trade_vote", { p_trade_id: id, p_vote: vote });

  if (error) {
    console.error("[trades] vote failed", error);
    // Not signed in reads differently from not allowed, and a manager who is
    // in the deal is neither — they are being told the rule.
    const status = /Not signed in/.test(error.message) ? 401 : 403;
    return Response.json({ error: error.message }, { status });
  }

  return Response.json({ ok: true, ...(data as Record<string, unknown>) });
}
