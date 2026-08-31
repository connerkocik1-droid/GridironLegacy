import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const PAGE = 40;

/** The kinds a manager can ask to see on their own. */
const KINDS = new Set(["add", "drop", "waiver", "trade"]);

/**
 * Everything that has happened to the league's rosters, newest first.
 *
 * The transactions table has recorded this since the first waiver claim and
 * nothing has ever read it, so "where did he go?" had an answer nobody could
 * reach. This is that answer.
 *
 * The draft is not in here on purpose. Every pick is on the board already, in
 * order and permanently, and a night that produces two hundred and eighty-eight
 * rows would bury a season's worth of actual comings and goings.
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
    .select("id, league_id")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  const url = new URL(req.url);
  const page = Math.max(0, Number(url.searchParams.get("page") ?? 0) || 0);
  const kind = url.searchParams.get("kind") ?? "all";
  const manager = url.searchParams.get("manager") ?? "all";
  // A page of the home band asks for a handful; the page itself asks for a page.
  const limit = Math.min(PAGE, Math.max(1, Number(url.searchParams.get("limit") ?? PAGE) || PAGE));

  let query = db
    .from("transactions")
    .select("id, manager_id, kind, player_name, detail, created_at", { count: "exact" })
    .eq("league_id", me.league_id)
    .order("created_at", { ascending: false })
    .range(page * limit, page * limit + limit - 1);

  if (KINDS.has(kind)) query = query.eq("kind", kind);
  if (manager !== "all") query = query.eq("manager_id", manager);

  const [{ data: rows, count }, { data: managers }] = await Promise.all([
    query,
    db
      .from("managers")
      .select("id, name, franchise, slot")
      .eq("league_id", me.league_id)
      .order("slot"),
  ]);

  const by = new Map((managers ?? []).map((m) => [m.id, m]));
  const total = count ?? 0;

  return Response.json({
    me,
    managers: managers ?? [],
    total,
    page,
    hasMore: total > (page + 1) * limit,
    entries: (rows ?? []).map((r) => {
      const detail = (r.detail ?? {}) as Record<string, unknown>;
      const actor = by.get(r.manager_id);
      const from =
        typeof detail.fromManager === "string" ? by.get(detail.fromManager) : undefined;
      return {
        id: r.id,
        kind: r.kind,
        player: r.player_name,
        at: r.created_at,
        // A franchise that has since been released leaves its rows behind, so
        // the log falls back to the name written down at the time.
        managerId: r.manager_id,
        franchise: actor?.franchise ?? "A former franchise",
        who: actor?.name ?? null,
        mine: r.manager_id === me.id,
        // Everything the sentence needs, flattened so the component does not
        // have to know the shape of a jsonb column.
        from: from?.franchise ?? (detail.fromFranchise as string | undefined) ?? null,
        // What was dropped to make room is deliberately absent: the drop is
        // its own row a second earlier, so carrying it here too would report
        // every swap twice.
        toWaivers: detail.waivers === true,
        clearsAt: (detail.clearsAt as string | undefined) ?? null,
        isPick: detail.pick === true,
      };
    }),
  });
}
