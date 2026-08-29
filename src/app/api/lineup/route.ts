import { player } from "@/lib/roster";
import { proj } from "@/lib/roster";
import { defaultLineup, validateLineup, type Assignment } from "@/lib/lineup";
import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const NOT_CONFIGURED = Response.json(
  { error: "The league database is not configured yet." },
  { status: 503 },
);

async function context(db: Awaited<ReturnType<typeof serverClient>>) {
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return null;

  const { data: me } = await db
    .from("managers")
    .select("id, slot, franchise, league_id")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return null;

  const { data: league } = await db
    .from("leagues")
    .select("settings")
    .eq("id", me.league_id)
    .single();

  return { me, settings: league?.settings ?? null };
}

/**
 * Which NFL teams have already kicked off this week. A player whose game has
 * started cannot be moved into or out of the lineup — that is the whole point
 * of a lineup deadline.
 */
async function lockedTeams(
  db: Awaited<ReturnType<typeof serverClient>>,
  week: number,
): Promise<Set<string>> {
  const { data } = await db
    .from("nfl_games")
    .select("home_team, away_team, starts_at, state")
    .eq("week", week);

  const locked = new Set<string>();
  const now = Date.now();

  for (const g of data ?? []) {
    if (g.state !== "pre" || new Date(g.starts_at).getTime() <= now) {
      locked.add(g.home_team);
      locked.add(g.away_team);
    }
  }
  return locked;
}

/** The manager's roster with its current slots, and what is locked. */
export async function GET(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;

  const db = await serverClient();
  const ctx = await context(db);
  if (!ctx) return Response.json({ error: "Not signed in" }, { status: 401 });

  const week = Number(new URL(req.url).searchParams.get("week") ?? 1);
  if (!Number.isInteger(week)) {
    return Response.json({ error: "week must be an integer" }, { status: 400 });
  }

  const { data: slots } = await db
    .from("roster_slots")
    .select("player_name, lineup_slot")
    .eq("manager_id", ctx.me.id);

  const roster = (slots ?? []).map((s) => s.player_name);

  // A manager who has never set a lineup still fields a legal one, rather than
  // starting nobody because every row says BENCH.
  const everSet = (slots ?? []).some((s) => s.lineup_slot !== "BENCH");
  const assignments: Assignment[] = everSet
    ? (slots ?? []).map((s) => ({ playerName: s.player_name, slot: s.lineup_slot }))
    : defaultLineup(roster, ctx.settings, proj);

  const locked = await lockedTeams(db, week);

  return Response.json({
    week,
    me: ctx.me,
    settings: ctx.settings,
    assignments,
    lockedPlayers: roster.filter((n) => {
      const p = player(n);
      return p ? locked.has(p.t) : false;
    }),
  });
}

/** Save a whole lineup. */
export async function PUT(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;

  const db = await serverClient();
  const ctx = await context(db);
  if (!ctx) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body: { assignments?: unknown; week?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.assignments)) {
    return Response.json({ error: "assignments must be an array" }, { status: 400 });
  }

  const assignments: Assignment[] = [];
  for (const raw of body.assignments) {
    const a = raw as { playerName?: unknown; slot?: unknown };
    if (typeof a?.playerName !== "string" || typeof a?.slot !== "string") {
      return Response.json({ error: "Each assignment needs a player and a slot" }, { status: 400 });
    }
    assignments.push({ playerName: a.playerName, slot: a.slot });
  }

  const { data: slots } = await db
    .from("roster_slots")
    .select("player_name, lineup_slot")
    .eq("manager_id", ctx.me.id);

  const current = new Map((slots ?? []).map((s) => [s.player_name, s.lineup_slot]));
  const roster = [...current.keys()];

  // The whole lineup is checked together: validating one move at a time would
  // let a manager reach an illegal lineup by legal-looking steps.
  const check = validateLineup(assignments, roster, ctx.settings);
  if (!check.ok) return Response.json({ error: check.error }, { status: 400 });

  const week = Number(body.week ?? 1);
  const locked = await lockedTeams(db, Number.isInteger(week) ? week : 1);

  for (const a of assignments) {
    const was = current.get(a.playerName);
    if (was === a.slot) continue;

    const p = player(a.playerName);
    if (p && locked.has(p.t)) {
      return Response.json(
        { error: `${a.playerName}'s game has started — his slot is locked` },
        { status: 409 },
      );
    }
  }

  // Only the rows that actually moved.
  const changed = assignments.filter((a) => current.get(a.playerName) !== a.slot);

  for (const a of changed) {
    const { error } = await db
      .from("roster_slots")
      .update({ lineup_slot: a.slot })
      .eq("manager_id", ctx.me.id)
      .eq("player_name", a.playerName);

    if (error) {
      console.error("[lineup] update failed", error);
      return Response.json({ error: "Your lineup was not saved" }, { status: 500 });
    }
  }

  return Response.json({ ok: true, changed: changed.length });
}
