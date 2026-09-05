import { freshenWeek } from "@/lib/live-refresh";
import { player, proj } from "@/lib/roster";
import { bestLineup, type Score } from "@/lib/matchup";
import { rank, type Team } from "@/lib/power";
import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const POSITIONS = ["QB", "RB", "WR", "TE", "K", "D/ST"];

interface Fixture {
  week: number;
  final: boolean;
  home_manager: string;
  away_manager: string;
}

/**
 * Everything the home page shows that is about the league rather than about
 * one manager: this week's fixtures with running totals, the best scorer at
 * each position, and the power rankings.
 *
 * Read in one request because the three disagree if they are read separately
 * while a Sunday is in progress — the scoreboard would say one thing and the
 * rankings another, from two snapshots seconds apart.
 */
export async function GET() {
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

  const [{ data: league }, { data: managers }, { data: slots }, { data: fixtures }, { data: table }] =
    await Promise.all([
      db
        .from("leagues")
        .select("name, season, settings, draft_at, draft_state")
        .eq("id", me.league_id)
        .single(),
      db
        .from("managers")
        .select("id, slot, name, franchise, division")
        .eq("league_id", me.league_id)
        .order("slot"),
      db.from("roster_slots").select("manager_id, player_name, lineup_slot").eq("league_id", me.league_id),
      db
        .from("matchups")
        .select("week, final, home_manager, away_manager")
        .eq("league_id", me.league_id)
        .order("week"),
      db.rpc("standings", { p_league_id: me.league_id }),
    ]);

  // Trades waiting on this manager's answer. Read here rather than on its own
  // schedule because an offer nobody knows about is an offer nobody answers —
  // the trade desk has always held these, and nothing has ever said so.
  const { data: offers } = await db
    .from("trades")
    .select("id, from_manager, to_manager, offer, status, from_accepted, to_accepted, created_at")
    .or(`from_manager.eq.${me.id},to_manager.eq.${me.id}`)
    .in("status", ["open", "countered"])
    .order("created_at", { ascending: false });

  const roster = managers ?? [];
  const held = slots ?? [];
  const schedule = (fixtures ?? []) as Fixture[];

  // The week worth looking at: the first one still to be settled, or the last
  // one played if the season is over. Not "today's date" — a league can be
  // graded late, and the page should follow the league, not the calendar.
  const unfinished = schedule.find((f) => !f.final);
  const week = unfinished?.week ?? schedule.at(-1)?.week ?? null;

  // Scores twice: this week's for the fixtures, and the season's for the
  // leaders. One read, split two ways.
  const { data: scoreRows } = await db
    .from("player_scores")
    .select("player_name, points, stat_line, week")
    .eq("league_id", me.league_id);

  const thisWeek = new Map<string, Score>(
    (scoreRows ?? [])
      .filter((r) => r.week === week)
      .map((r) => [r.player_name, { points: Number(r.points), statLine: r.stat_line ?? "" }]),
  );

  const settings = league?.settings ?? null;

  // Whether this week's games are actually being played, which is a question
  // about the NFL and not about us. The old answer — "do we hold any score
  // rows for this week" — went true the moment the first game kicked off and
  // stayed true through the following Saturday, so a Wednesday read as a live
  // Sunday.
  //
  // Reading it also sets the next pull going, off the back of this response.
  const state = await freshenWeek(db, me.league_id, league?.season, week);

  // What each franchise is putting on the field this week — which nobody
  // chooses, so it is the best arrangement of the whole roster. Projected
  // until the slate starts and real from then on, the same rule the matchup
  // page and the grader use.
  const lineupBasis = state.started ? "points" : "projection";
  const totalFor = (managerId: string): number => {
    const mine = held
      // Injured reserve is out of the week entirely: he does not count against
      // the roster, so he cannot score for it either.
      .filter((s) => s.manager_id === managerId && s.lineup_slot !== "IR")
      .map((s) => s.player_name);
    const rows = bestLineup(mine, settings, thisWeek, lineupBasis);
    return Math.round(rows.reduce((sum, r) => sum + (r.entry?.points ?? 0), 0) * 10) / 10;
  };

  const totals = new Map(roster.map((m) => [m.id, totalFor(m.id)]));
  const byId = new Map(roster.map((m) => [m.id, m]));

  const side = (id: string) => {
    const m = byId.get(id);
    return m
      ? { id, slot: m.slot, name: m.name, franchise: m.franchise, total: totals.get(id) ?? 0 }
      : null;
  };

  const games = schedule
    .filter((f) => f.week === week)
    .map((f) => ({
      final: f.final,
      home: side(f.home_manager),
      away: side(f.away_manager),
      mine: f.home_manager === me.id || f.away_manager === me.id,
    }))
    .filter((g) => g.home && g.away);

  // A franchise with no fixture this week has a bye, which an odd league
  // produces legitimately. Naming them is kinder than leaving them off.
  const playing = new Set(
    schedule.filter((f) => f.week === week).flatMap((f) => [f.home_manager, f.away_manager]),
  );
  const byes = roster.filter((m) => !playing.has(m.id)).map((m) => ({ slot: m.slot, franchise: m.franchise }));

  // --- the best at each position -------------------------------------------
  // Real points once anyone has scored any. Before then a projection is the
  // only number that exists, and the page labels it as such rather than
  // showing an empty panel for the whole of the offseason.
  const season = new Map<string, number>();
  for (const row of scoreRows ?? []) {
    season.set(row.player_name, (season.get(row.player_name) ?? 0) + Number(row.points));
  }

  const owner = new Map(held.map((s) => [s.player_name, s.manager_id]));
  const basis: "scored" | "projected" = season.size > 0 ? "scored" : "projected";

  // Drawn from the players the twelve franchises actually hold. A free agent
  // outscoring all of them is a story for the free-agent page; this panel is
  // about the league.
  const leaders = POSITIONS.map((position) => {
    let best: { name: string; points: number } | null = null;

    for (const name of owner.keys()) {
      const p = player(name);
      if (!p || p.p !== position) continue;
      const points = basis === "scored" ? (season.get(name) ?? 0) : proj(name);
      if (!best || points > best.points) best = { name, points };
    }

    if (!best) return { position, player: null };

    const p = player(best.name);
    const holder = owner.get(best.name);
    const m = holder ? byId.get(holder) : undefined;

    return {
      position,
      player: {
        name: best.name,
        team: p?.t ?? "",
        points: Math.round(best.points * 10) / 10,
        franchise: m?.franchise ?? null,
        managerSlot: m?.slot ?? null,
      },
    };
  });

  // --- power rankings -------------------------------------------------------
  interface Standing {
    manager_id: string;
    wins: number;
    losses: number;
    ties: number;
    points_for: number;
  }

  const record = new Map(
    ((table ?? []) as Standing[]).map((r) => [
      r.manager_id,
      { wins: r.wins, losses: r.losses, ties: r.ties, pointsFor: Number(r.points_for) },
    ]),
  );

  // Points scored across the whole season by the players a franchise holds.
  // The standings table only counts graded weeks; this counts everything, so
  // the ranking moves during a week rather than only at the end of one.
  const scoredFor = new Map<string, number>();
  for (const [name, points] of season) {
    const holder = owner.get(name);
    if (!holder) continue;
    scoredFor.set(holder, (scoredFor.get(holder) ?? 0) + points);
  }

  const teams: Team[] = roster.map((m) => {
    const r = record.get(m.id);
    return {
      id: m.id,
      wins: r?.wins ?? 0,
      losses: r?.losses ?? 0,
      ties: r?.ties ?? 0,
      pointsFor: Math.round((scoredFor.get(m.id) ?? r?.pointsFor ?? 0) * 10) / 10,
    };
  });

  const power = rank(teams).map((t) => {
    const m = byId.get(t.id);
    return {
      id: t.id,
      slot: m?.slot ?? "",
      franchise: m?.franchise ?? "",
      name: m?.name ?? "",
      rank: t.rank,
      rating: t.rating,
      wins: t.wins,
      losses: t.losses,
      ties: t.ties,
      pointsFor: t.pointsFor,
      mine: t.id === me.id,
    };
  });

  // Only the ones it is this manager's turn to answer. A counter coming back
  // is as much a question as the original offer, which is why this is about
  // whose acceptance is missing rather than about who sent it.
  const asked = (offers ?? []).filter((t) =>
    t.to_manager === me.id ? !t.to_accepted : !t.from_accepted,
  );

  const franchiseOf = new Map(roster.map((m) => [m.id, m.franchise]));

  const trades = asked.map((t) => {
    const incoming = t.to_manager === me.id;
    const offer = (t.offer ?? {}) as {
      give?: string[];
      get?: string[];
      givePicks?: string[];
      getPicks?: string[];
    };

    // `give` leaves the proposer and `get` leaves the receiver, so which of
    // them is coming to this manager depends on which end of it they are.
    const coming = (incoming ? offer.give : offer.get) ?? [];
    const going = (incoming ? offer.get : offer.give) ?? [];
    const comingPicks = ((incoming ? offer.givePicks : offer.getPicks) ?? []).length;
    const goingPicks = ((incoming ? offer.getPicks : offer.givePicks) ?? []).length;

    return {
      id: t.id as string,
      from: franchiseOf.get(incoming ? t.from_manager : t.to_manager) ?? "Somebody",
      countered: t.status === "countered",
      get: coming,
      give: going,
      getPicks: comingPicks,
      givePicks: goingPicks,
    };
  });

  return Response.json({
    meId: me.id,
    trades,
    league: league
      ? {
          name: league.name,
          season: league.season,
          // Draft night, for the home page. Before the schedule exists it is
          // the only thing happening in this league and the home page said
          // nothing about it at all.
          draftAt: (league.draft_at as string | null) ?? null,
          draftState: (league.draft_state as string | null) ?? "pending",
        }
      : null,
    week,
    games,
    byes,
    // `live` is a game in progress this second; `started` is anything on the
    // slate having kicked off. The matchup band needs both: one decides
    // whether to show a score at all, the other whether to call it current.
    live: state.live,
    started: state.started,
    weekPhase: state.phase,
    leaders,
    leaderBasis: basis,
    power,
    // Whether any week has actually been settled. The rankings say what they
    // are built on rather than implying a record nobody has yet.
    played: teams.some((t) => t.wins + t.losses + t.ties > 0),
  });
}
