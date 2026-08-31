import { POOL } from "@/data/league-data";
import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const PAGE = 60;

/**
 * Everyone nobody holds, plus this manager's own roster, their pending claims,
 * and the waiver wire — read together so they cannot disagree with each other.
 *
 * The wire is the difference between the two halves of this list. A player on
 * it was dropped recently and can only be claimed; everybody else is a free
 * agent and can be added on the spot.
 */
export async function GET(req: Request) {
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
    .select("id, slot, franchise, league_id, waiver_priority")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  const url = new URL(req.url);
  const position = url.searchParams.get("position") ?? "ALL";
  const search = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  const page = Math.max(0, Number(url.searchParams.get("page") ?? 0) || 0);

  const [{ data: league }, { data: rostered }, { data: mine }, { data: claims }, { data: wire }] =
    await Promise.all([
      db.from("leagues").select("settings").eq("id", me.league_id).single(),
      db.from("roster_slots").select("player_name, manager_id").eq("league_id", me.league_id),
      db.from("roster_slots").select("player_name, lineup_slot").eq("manager_id", me.id),
      db
        .from("waiver_claims")
        .select("id, add_player, drop_player, claim_order, status, reason, created_at")
        .eq("manager_id", me.id)
        .order("claim_order"),
      db
        .from("waiver_wire")
        .select("player_name, clears_at, dropped_by")
        .eq("league_id", me.league_id)
        .order("clears_at"),
    ]);

  const taken = new Set((rostered ?? []).map((r) => r.player_name));
  const clears = new Map((wire ?? []).map((w) => [w.player_name, w.clears_at as string]));

  const free = POOL.filter((p) => {
    if (taken.has(p.n)) return false;
    if (position !== "ALL" && p.p !== position) return false;
    if (search && !p.n.toLowerCase().includes(search)) return false;
    return true;
  }).sort((a, b) => a.adp - b.adp);

  const settings = league?.settings ?? {};
  const starters: Record<string, number> = settings.starters ?? {};
  const capacity =
    Object.values(starters).reduce((sum, n) => sum + Number(n || 0), 0) +
    Number(settings.bench ?? 0);

  // IR sits outside the roster count, the same rule the database enforces.
  const held = (mine ?? []).filter((r) => r.lineup_slot !== "IR").length;

  const mode =
    settings.waiverMode === "open" || settings.waiverMode === "all"
      ? (settings.waiverMode as "open" | "all")
      : "waivers";

  return Response.json({
    me,
    // "waivers": dropped players are claimed, everyone else is an instant add.
    // "open": no wire at all. "all": every pickup is a claim.
    mode,
    waiverDays: Math.max(1, Number(settings.waiverDays ?? 1) || 1),
    capacity,
    held,
    roster: mine ?? [],
    claims: claims ?? [],
    // The whole wire, not just this page of it: it is short, and it is the
    // one list a manager wants to see before the run rather than after.
    wire: (wire ?? []).map((w) => ({
      name: w.player_name,
      clearsAt: w.clears_at,
      position: POOL.find((p) => p.n === w.player_name)?.p ?? "",
      team: POOL.find((p) => p.n === w.player_name)?.t ?? "",
      mine: w.dropped_by === me.id,
    })),
    total: free.length,
    page,
    hasMore: free.length > (page + 1) * PAGE,
    players: free.slice(page * PAGE, (page + 1) * PAGE).map((p) => ({
      name: p.n,
      position: p.p,
      team: p.t,
      adp: p.adp,
      posRank: p.posRank,
      bye: p.bye,
      clearsAt: clears.get(p.n) ?? null,
    })),
  });
}
