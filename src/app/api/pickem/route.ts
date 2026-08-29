import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const NOT_CONFIGURED = Response.json(
  { error: "The league database is not configured yet." },
  { status: 503 },
);

interface GameRow {
  id: string;
  week: number;
  starts_at: string;
  home_team: string;
  away_team: string;
  home_score: number;
  away_score: number;
  state: string;
  winner: string | null;
  completed: boolean;
}

/** The week's games, this manager's picks, and the league standings. */
export async function GET(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;
  const db = await serverClient();

  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { data: me } = await db
    .from("managers")
    .select("id, slot, franchise, league_id")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  const url = new URL(req.url);
  const weekParam = url.searchParams.get("week");

  let week = weekParam ? Number(weekParam) : null;
  if (weekParam && !Number.isInteger(week)) {
    return Response.json({ error: "week must be an integer" }, { status: 400 });
  }

  // Default to the earliest week that still has an unfinished game.
  if (week == null) {
    const { data } = await db
      .from("nfl_games")
      .select("week")
      .eq("completed", false)
      .order("starts_at", { ascending: true })
      .limit(1);
    week = data?.[0]?.week ?? null;
  }

  if (week == null) return Response.json({ week: null, games: [], picks: {}, standings: [] });

  const { data: games } = await db
    .from("nfl_games")
    .select("id, week, starts_at, home_team, away_team, home_score, away_score, state, winner, completed")
    .eq("week", week)
    .order("starts_at", { ascending: true });

  const { data: myPicks } = await db
    .from("pickem_picks")
    .select("game_id, pick")
    .eq("manager_id", me.id);

  // Season standings: a pick is correct when it names the winner. Ties score
  // nothing for anyone, which is why winner stays null on a drawn game.
  const { data: allPicks } = await db
    .from("pickem_picks")
    .select("manager_id, pick, game_id, nfl_games!inner(winner, completed)")
    .eq("league_id", me.league_id);

  const { data: managers } = await db
    .from("managers")
    .select("id, slot, franchise")
    .eq("league_id", me.league_id);

  const tally = new Map<string, { correct: number; played: number }>();
  for (const row of allPicks ?? []) {
    const game = row.nfl_games as unknown as { winner: string | null; completed: boolean };
    if (!game?.completed) continue;
    const entry = tally.get(row.manager_id) ?? { correct: 0, played: 0 };
    entry.played += 1;
    if (game.winner && row.pick === game.winner) entry.correct += 1;
    tally.set(row.manager_id, entry);
  }

  const standings = (managers ?? [])
    .map((m) => {
      const entry = tally.get(m.id) ?? { correct: 0, played: 0 };
      return {
        managerId: m.id,
        slot: m.slot,
        franchise: m.franchise,
        correct: entry.correct,
        played: entry.played,
        pct: entry.played ? Math.round((entry.correct / entry.played) * 1000) / 10 : 0,
      };
    })
    .sort((a, b) => b.correct - a.correct || b.pct - a.pct);

  const picks = Object.fromEntries((myPicks ?? []).map((p) => [p.game_id, p.pick]));

  return Response.json({
    week,
    me: { id: me.id, slot: me.slot, franchise: me.franchise },
    games: (games ?? []) as GameRow[],
    picks,
    standings,
  });
}

/** Save or change a pick. Locked at kickoff, enforced in the database. */
export async function POST(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;
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

  let body: { gameId?: unknown; pick?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const gameId = typeof body.gameId === "string" ? body.gameId : "";
  const pick = typeof body.pick === "string" ? body.pick : "";
  if (!gameId || !pick) {
    return Response.json({ error: "gameId and pick are required" }, { status: 400 });
  }

  // The pick must name a team actually playing in that game.
  const { data: game } = await db
    .from("nfl_games")
    .select("home_team, away_team, starts_at")
    .eq("id", gameId)
    .single();

  if (!game) return Response.json({ error: "Unknown game" }, { status: 404 });
  if (pick !== game.home_team && pick !== game.away_team) {
    return Response.json({ error: "That team is not in this game" }, { status: 400 });
  }
  if (new Date(game.starts_at) <= new Date()) {
    return Response.json({ error: "This game has kicked off" }, { status: 409 });
  }

  const { error } = await db.from("pickem_picks").upsert(
    {
      league_id: me.league_id,
      manager_id: me.id,
      game_id: gameId,
      pick,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "manager_id,game_id" },
  );

  // The kickoff rule is also an RLS check, so a stale client gets refused here.
  if (error) return Response.json({ error: "Pick was not saved" }, { status: 409 });

  return Response.json({ ok: true, gameId, pick });
}
