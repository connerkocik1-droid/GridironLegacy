import { lineupProblems } from "@/lib/lineup";
import { freshenWeek } from "@/lib/live-refresh";
import { player, proj } from "@/lib/roster";
import { setLineup, type Score } from "@/lib/matchup";
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
      db.from("leagues").select("name, season, settings").eq("id", me.league_id).single(),
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

  // What each franchise is putting on the field this week. A manager who has
  // never set a lineup is fielded at their best legal one, the same fallback
  // the matchup page uses, so no franchise shows a zero it did not earn.
  const totalFor = (managerId: string): number => {
    const mine = held.filter((s) => s.manager_id === managerId);
    const rows = setLineup(mine, settings, thisWeek);
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

  // What is wrong with this manager's own lineup, counted rather than listed:
  // the home page's job is to say "go and look", and the lineup page is where
  // the problems are named. Only before the week is settled — telling somebody
  // they started a bye player in a week already graded is a reproach, not help.
  const mySlots = held
    .filter((s) => s.manager_id === me.id)
    .map((s) => ({ playerName: s.player_name, slot: s.lineup_slot }));

  const settled = schedule.some((f) => f.week === week && f.final);
  const myProblems =
    week == null || settled
      ? 0
      : lineupProblems(mySlots, settings, week, (name) => {
          const pl = player(name);
          return pl ? { p: pl.p, bye: pl.bye, q: pl.q } : null;
        }).filter((x) => x.kind !== "injured").length;

  return Response.json({
    meId: me.id,
    lineupProblems: myProblems,
    league: league ? { name: league.name, season: league.season } : null,
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
