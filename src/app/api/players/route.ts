import { POOL } from "@/data/league-data";
import { teamGames } from "@/lib/nfl-week";
import { COLUMNS, rank, sortRows, type Group, type Row } from "@/lib/rankings";
import { isConfigured, serverClient } from "@/lib/supabase";
import { currentWeek } from "@/lib/week";
import { IR_ELIGIBLE } from "@/lib/health";

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

  // Only a key the board actually has. Anything else is ADP, which is the
  // order the list has always been in and the sensible answer before a ball
  // has been kicked.
  const asked = url.searchParams.get("sort") ?? "adp";
  const sortable = new Set<string>([
    "adp",
    "position",
    "total",
    "ppg",
    ...Object.values(COLUMNS).flatMap((columns) => columns.map((c) => c.key)),
  ]);
  const sort = sortable.has(asked) ? asked : "adp";

  const [{ data: league }, { data: rostered }, { data: mine }, { data: claims }, { data: wire }] =
    await Promise.all([
      db.from("leagues").select("season, settings").eq("id", me.league_id).single(),
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

  // Whose game has started. The database refuses these moves whatever the
  // page says, but a button that always fails is worse than no button — a
  // manager who cannot see why is a manager who thinks the app is broken.
  const week = await currentWeek(db, me.league_id);
  const { data: games } = await db
    .from("nfl_games")
    .select("home_team, away_team, starts_at, state")
    .eq("season", league?.season ?? 0)
    .eq("week", week ?? 0);
  const byTeam = teamGames(games ?? []);
  const started = (team: string) => {
    const g = byTeam[team];
    return g ? g.state !== "pre" : false;
  };

  // What everybody has actually done this season, worked out by the same code
  // the rankings board uses — so a free agent's numbers here and his numbers
  // on the League tab are the same numbers rather than two attempts at them.
  const { data: scoreRows } = await db
    .from("player_scores")
    .select("player_name, points, week, stats")
    .eq("league_id", me.league_id);

  const weeksOf = new Map<string, Set<number>>();
  const totalOf = new Map<string, number>();
  const lineOf = new Map<string, Record<string, number>>();
  const seenIn = new Map<string, Record<string, number>>();

  for (const row of scoreRows ?? []) {
    const name = row.player_name as string;
    totalOf.set(name, (totalOf.get(name) ?? 0) + Number(row.points));
    const weeks = weeksOf.get(name) ?? new Set<number>();
    weeks.add(row.week as number);
    weeksOf.set(name, weeks);

    const line = lineOf.get(name) ?? {};
    const appearances = seenIn.get(name) ?? {};
    for (const [key, value] of Object.entries((row.stats ?? {}) as Record<string, unknown>)) {
      if (typeof value !== "number" || !Number.isFinite(value)) continue;
      line[key] = (line[key] ?? 0) + value;
      appearances[key] = (appearances[key] ?? 0) + 1;
    }
    lineOf.set(name, line);
    seenIn.set(name, appearances);
  }

  const leaguePoints: Record<string, { total: number; games: number }> = {};
  for (const [name, total] of totalOf) {
    leaguePoints[name] = {
      total: Math.round(total * 10) / 10,
      games: weeksOf.get(name)?.size ?? 0,
    };
  }

  const played: Record<string, { line: Record<string, number>; games: Record<string, number> }> = {};
  for (const [name, line] of lineOf) {
    played[name] = { line, games: seenIn.get(name) ?? {} };
  }

  const heldBy: Record<string, string> = {};
  for (const r of rostered ?? []) heldBy[r.player_name] = "held";

  const scored = Object.keys(leaguePoints).length > 0;
  const board = new Map<string, Row>(
    rank(leaguePoints, heldBy, scored, played).map((r) => [r.name, r]),
  );

  const taken = new Set((rostered ?? []).map((r) => r.player_name));
  const clears = new Map((wire ?? []).map((w) => [w.player_name, w.clears_at as string]));

  const matching = POOL.filter((p) => {
    if (taken.has(p.n)) return false;
    if (position !== "ALL" && p.p !== position) return false;
    if (search && !p.n.toLowerCase().includes(search)) return false;
    return true;
  });

  // Sorted here rather than in the browser, because the browser only has the
  // sixty rows it was sent: ordering those by points would answer "the best of
  // the players nearest the top of the ADP list", which is not a question
  // anybody asked.
  let free: typeof matching;

  if (sort === "adp") {
    free = matching.sort((a, b) => a.adp - b.adp);
  } else if (sort === "position") {
    // Grouped by what they play, best first inside each group, so a manager
    // shopping for one thing reads one run of rows.
    const order = ["QB", "RB", "WR", "TE", "K", "D/ST"];
    const rankOf = (p: (typeof matching)[number]) => {
      const at = order.indexOf(p.p);
      return at === -1 ? order.length : at;
    };
    free = matching.sort(
      (a, b) =>
        rankOf(a) - rankOf(b) ||
        (board.get(b.n)?.total ?? 0) - (board.get(a.n)?.total ?? 0) ||
        a.adp - b.adp,
    );
  } else {
    // Every other key is a column on the rankings board, so the board does the
    // sorting and this puts the pool back in that order.
    const rows = matching
      .map((p) => board.get(p.n))
      .filter((r): r is Row => r != null);
    const at = new Map(sortRows(rows, sort, false).map((r, i) => [r.name, i]));
    free = matching.sort(
      (a, b) => (at.get(a.n) ?? Infinity) - (at.get(b.n) ?? Infinity) || a.adp - b.adp,
    );
  }

  const settings = league?.settings ?? {};
  const starters: Record<string, number> = settings.starters ?? {};
  const capacity =
    Object.values(starters).reduce((sum, n) => sum + Number(n || 0), 0) +
    Number(settings.bench ?? 0);

  // Everybody the injury report puts on IR or under suspension. Short — a few
  // hundred across the whole league — and sent whole rather than per-player so
  // the free-agent list can offer the reserve without a request per row.
  const { data: hurt } = await db
    .from("nfl_players")
    .select("name")
    .in("injury_status", [...IR_ELIGIBLE]);

  const stashable = new Set((hurt ?? []).map((r: { name: string }) => r.name));

  // IR sits outside the roster count — but only while the man in it belongs
  // there. The same rule roster_count() enforces since 0046: a stashed player
  // the report has cleared is on the books where he sits.
  const held = (mine ?? []).filter(
    (r) => r.lineup_slot !== "IR" || !stashable.has(r.player_name),
  ).length;

  const irHeld = (mine ?? []).filter((r) => r.lineup_slot === "IR").length;

  const mode =
    settings.waiverMode === "open" || settings.waiverMode === "all"
      ? (settings.waiverMode as "open" | "all")
      : "waivers";

  // Whether today is the league's claim day, which the database decides — it
  // knows the league's clock and it is the thing that will refuse the add.
  // Asked here so the page offers "Claim" rather than an "Add" button that
  // comes back with an error a manager did nothing to deserve.
  const { data: claimDay } = await db.rpc("waiver_day", { p_league_id: me.league_id });

  return Response.json({
    me,
    // "waivers": dropped players are claimed, everyone else is an instant add.
    // "open": no wire at all. "all": every pickup is a claim.
    mode,
    // True for the whole of the claim day. Everything on the board is a claim
    // while it is, and they all settle together when the day is over.
    claimDay: claimDay === true,
    waiverDays: Math.max(1, Number(settings.waiverDays ?? 1) || 1),
    capacity,
    held,
    // What the league actually fields. The Moves advice is about starting
    // slots, so it has to be the league's shape rather than a default.
    starters,
    // What the reserve holds and how full it is, so the page can offer a free
    // agent on IR the one add that does not cost a roster spot.
    irLimit: Number(settings.ir ?? 0),
    irHeld,
    irEligible: [...stashable],
    // Each of your own, and whether he can still be dropped this week.
    roster: (mine ?? []).map((r) => ({
      ...r,
      locked: started(POOL.find((p) => p.n === r.player_name)?.t ?? ""),
    })),
    claims: claims ?? [],
    // The whole wire, not just this page of it: it is short, and it is the
    // one list a manager wants to see before the run rather than after.
    wire: (wire ?? []).map((w) => ({
      name: w.player_name,
      clearsAt: w.clears_at,
      position: POOL.find((p) => p.n === w.player_name)?.p ?? "",
      team: POOL.find((p) => p.n === w.player_name)?.t ?? "",
      mine: w.dropped_by === me.id,
      locked: started(POOL.find((p) => p.n === w.player_name)?.t ?? ""),
    })),
    total: free.length,
    page,
    hasMore: free.length > (page + 1) * PAGE,
    // Which columns mean something for the group being looked at, so the
    // rows and the sort control are describing the same statistics.
    columns: COLUMNS[(position === "ALL" ? "ALL" : position) as Group] ?? COLUMNS.ALL,
    sort,
    players: free.slice(page * PAGE, (page + 1) * PAGE).map((p) => {
      const row = board.get(p.n);
      return {
        name: p.n,
        position: p.p,
        team: p.t,
        adp: p.adp,
        posRank: p.posRank,
        bye: p.bye,
        clearsAt: clears.get(p.n) ?? null,
        // His club is on the field, or has left it. Not a pickup this week.
        locked: started(p.t),
        // What he has actually done. Nought points and no rates is an honest
        // answer for somebody who has not played, and it is what the board
        // says about him too.
        points: row?.total ?? 0,
        ppg: row?.ppg ?? 0,
        games: row?.games ?? 0,
        stats: row?.stats ?? {},
      };
    }),
  });
}
