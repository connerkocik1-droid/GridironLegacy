import { player } from "@/lib/roster";
import { recapOpensAt, type RecapGame, type RecapPlayer } from "@/lib/recap";
import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** One line of the frozen best-ball snapshot grade_week wrote. */
interface Starter {
  name?: string;
  slot?: string;
  points?: number;
}

/**
 * The week just gone, as a recap needs it.
 *
 * Every figure comes off the same two tables the League screen reads — the
 * fixtures and what each side scored — so the recap cannot tell a manager
 * something the rest of the app disagrees with. Nothing here is authored: the
 * MVP is whoever scored most, the margin is a subtraction, and the standings
 * move is the table before against the table after.
 *
 * The lineup is the frozen one. `grade_week` photographs the best-ball
 * arrangement when the last game ends, and that photograph is what the week
 * was graded on — recomputing it now would let a trade in November change who
 * carried a week in September.
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

  const me = await readMe(db, user.id);
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  const [{ data: league }, { data: managers }, { data: fixtures }] = await Promise.all([
    db.from("leagues").select("season").eq("id", me.league_id).single(),
    db.from("managers").select("id, name, franchise").eq("league_id", me.league_id).order("slot"),
    db
      .from("matchups")
      .select(
        "week, home_manager, away_manager, home_points, away_points, final, playoff, graded_at, home_starters, away_starters",
      )
      .eq("league_id", me.league_id)
      .order("week"),
  ]);

  const all = fixtures ?? [];
  const graded = all.filter((f) => f.final);

  // The week just played is the last one that settled. Not "the current week
  // minus one": a week nobody has graded has no result to recap, and a league
  // that skipped one should recap the last real thing that happened.
  const week = graded.reduce((max, f) => Math.max(max, f.week), 0) || null;

  if (week == null) {
    return Response.json({ recap: null, seenWeek: me.recap_seen_week, opensAt: null });
  }

  const games: RecapGame[] = graded.map((f) => ({
    week: f.week,
    home: f.home_manager,
    away: f.away_manager,
    homePoints: Number(f.home_points ?? 0),
    awayPoints: Number(f.away_points ?? 0),
    playoff: Boolean(f.playoff),
  }));

  // This manager's own fixture in the week being recapped, so the snapshot is
  // read from the right side of it.
  const mine = graded.find(
    (f) => f.week === week && (f.home_manager === me.id || f.away_manager === me.id),
  );
  const snapshot = mine
    ? ((mine.home_manager === me.id ? mine.home_starters : mine.away_starters) as Starter[] | null)
    : null;

  const myWeek: RecapPlayer[] = (snapshot ?? [])
    .filter((s): s is Starter & { name: string } => typeof s?.name === "string")
    .map((s) => {
      const pooled = player(s.name);
      return {
        name: s.name,
        // The slot is what the lineup called him, which for a flex is not his
        // position. The pool answers what he actually plays.
        position: pooled?.p ?? s.slot ?? "",
        team: pooled?.t ?? "",
        points: Math.round(Number(s.points ?? 0) * 10) / 10,
      };
    });

  // Next week's fixture, which is not graded and so is not one of the games
  // the record is read off.
  const nextFixture = all.find(
    (f) => f.week === week + 1 && (f.home_manager === me.id || f.away_manager === me.id),
  );

  const kickoff = nextFixture ? await firstKickoff(db, league?.season, week + 1) : null;

  return Response.json({
    seenWeek: me.recap_seen_week,
    // When this week's recap is allowed to play: the moment the commissioner
    // locked the week. Sent as an instant, so the browser is never asked what
    // day it is where it happens to be standing.
    opensAt: recapOpensAt(gradedAtOf(graded, week)),
    recap: {
      week,
      meId: me.id,
      teams: (managers ?? []).map((m) => ({ id: m.id, franchise: m.franchise, owner: m.name })),
      games,
      myWeek,
      next: nextFixture
        ? {
            week: week + 1,
            opponentId:
              nextFixture.home_manager === me.id
                ? nextFixture.away_manager
                : nextFixture.home_manager,
            kickoff,
          }
        : null,
    },
  });
}

/** Mark the recap seen, so it plays once rather than on every launch. */
export async function POST(req: Request) {
  if (!isConfigured()) {
    return Response.json({ error: "The league database is not configured yet." }, { status: 503 });
  }

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const week = Number(body?.week);
  if (!Number.isInteger(week)) {
    return Response.json({ error: "week must be an integer" }, { status: 400 });
  }

  const { data, error } = await db.rpc("see_recap", { p_week: week });
  if (error) {
    // The column and the function arrive with migration 0056, and a deploy can
    // reach a browser before its SQL reaches the database. Saying so beats
    // failing the dismissal — the recap closes either way, and the worst that
    // happens in that window is that it plays again on the next launch.
    console.warn("[recap] could not mark it seen", error.message);
    return Response.json({ seenWeek: null, stored: false });
  }

  return Response.json({ seenWeek: data ?? week, stored: true });
}

type Db = Awaited<ReturnType<typeof serverClient>>;

/**
 * The signed-in manager, with the recap marker if the database has it.
 *
 * Naming a column that is not there fails the whole select, and this route
 * turning that into a 500 would put an error on the home page for the sake of
 * a feature that is allowed to be absent.
 */
async function readMe(
  db: Db,
  authUserId: string,
): Promise<{ id: string; league_id: string; recap_seen_week: number | null } | null> {
  const withMarker = await db
    .from("managers")
    .select("id, league_id, recap_seen_week")
    .eq("auth_user_id", authUserId)
    .single();
  if (!withMarker.error && withMarker.data) {
    return withMarker.data as { id: string; league_id: string; recap_seen_week: number | null };
  }
  if (!withMarker.error) return null;

  console.warn("[recap] no recap marker yet, reading without it", withMarker.error.message);
  const plain = await db
    .from("managers")
    .select("id, league_id")
    .eq("auth_user_id", authUserId)
    .single();
  if (plain.error || !plain.data) return null;
  return { ...plain.data, recap_seen_week: null };
}

/** When the next week's football starts, for the "next up" card. */
async function firstKickoff(
  db: Db,
  season: number | undefined,
  week: number,
): Promise<string | null> {
  if (!season) return null;
  const { data } = await db
    .from("nfl_games")
    .select("starts_at")
    .eq("season", season)
    .eq("week", week)
    .order("starts_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data?.starts_at as string | null) ?? null;
}

/** When the week was locked, which is when its recap becomes due. */
function gradedAtOf(
  graded: { week: number; graded_at?: string | null }[],
  week: number,
): string | null {
  for (const f of graded) if (f.week === week && f.graded_at) return f.graded_at;
  return null;
}
