import { POOL } from "@/data/league-data";
import { byDynastyAdp, valueOf } from "@/lib/dynasty";
import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const PAGE = 60;

/**
 * Everyone nobody holds, plus this manager's own roster and pending claims —
 * the three things the add/drop screen needs, read together so they cannot
 * disagree with each other.
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

  const [{ data: league }, { data: rostered }, { data: mine }, { data: claims }] =
    await Promise.all([
      db.from("leagues").select("settings").eq("id", me.league_id).single(),
      db.from("roster_slots").select("player_name, manager_id").eq("league_id", me.league_id),
      db.from("roster_slots").select("player_name, lineup_slot").eq("manager_id", me.id),
      db
        .from("waiver_claims")
        .select("id, add_player, drop_player, claim_order, status, reason, created_at")
        .eq("manager_id", me.id)
        .order("claim_order"),
    ]);

  const taken = new Set((rostered ?? []).map((r) => r.player_name));

  const free = POOL.filter((p) => {
    if (taken.has(p.n)) return false;
    if (position !== "ALL" && p.p !== position) return false;
    if (search && !p.n.toLowerCase().includes(search)) return false;
    return true;
  })
    .map((p) => ({ player: p, value: valueOf(p) }))
    .sort((a, b) => byDynastyAdp(a.value, b.value));

  const settings = league?.settings ?? {};
  const starters: Record<string, number> = settings.starters ?? {};
  const capacity =
    Object.values(starters).reduce((sum, n) => sum + Number(n || 0), 0) +
    Number(settings.bench ?? 0);

  // IR sits outside the roster count, the same rule the database enforces.
  const held = (mine ?? []).filter((r) => r.lineup_slot !== "IR").length;

  return Response.json({
    me,
    // "waivers" means claims queue for the scheduled run; "open" means an add
    // lands immediately, first come first served.
    mode: settings.waiverMode === "open" ? "open" : "waivers",
    capacity,
    held,
    roster: mine ?? [],
    claims: claims ?? [],
    total: free.length,
    page,
    hasMore: free.length > (page + 1) * PAGE,
    players: free.slice(page * PAGE, (page + 1) * PAGE).map(({ player: p, value }) => ({
      name: p.n,
      position: p.p,
      team: p.t,
      adp: p.adp,
      dynastyAdp: value.dynastyAdp,
      age: value.age,
      modifier: value.modifier,
      posRank: p.posRank,
      bye: p.bye,
    })),
  });
}
