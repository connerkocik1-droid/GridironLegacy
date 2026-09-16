import {
  movement,
  type BoardReport,
  type Move,
} from "@/lib/pylon-report";
import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface Row {
  week: number;
  college: BoardReport;
  nfl: BoardReport;
  published_at: string;
}

/**
 * The latest Pylon Report, and how the boards moved to get there.
 *
 * Two weeks are read rather than one: the arrows are the difference between
 * them, and working that out here means the browser is handed a finished
 * report rather than two of them and the arithmetic.
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
    .select("league_id, is_commissioner")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  const { data, error } = await db
    .from("pylon_reports")
    .select("week, college, nfl, published_at")
    .eq("league_id", me.league_id)
    .order("week", { ascending: false })
    .limit(2);

  if (error) {
    // The table arrives with migration 0059 and a deploy can reach a browser
    // before its SQL reaches the database. No report is a state the page
    // already draws, so it is a better answer here than a failure.
    console.warn("[report] no reports table yet", error.message);
    return Response.json({ report: null, isCommissioner: me.is_commissioner === true });
  }

  const rows = (data ?? []) as Row[];
  const now = rows[0] ?? null;
  const before = rows[1] ?? null;

  if (!now) {
    return Response.json({ report: null, isCommissioner: me.is_commissioner === true });
  }

  return Response.json({
    isCommissioner: me.is_commissioner === true,
    report: {
      week: now.week,
      publishedAt: now.published_at,
      /** The week the arrows are measured against, or null for the first one. */
      against: before?.week ?? null,
      college: now.college,
      nfl: now.nfl,
      moves: {
        college: asObject(movement(now.college, before?.college ?? null)),
        nfl: asObject(movement(now.nfl, before?.nfl ?? null)),
      },
    },
  });
}

/** A Map does not survive JSON. */
function asObject(moves: Map<string, Move>): Record<string, Move> {
  return Object.fromEntries(moves);
}


/**
 * Publish a week's report.
 *
 * The parsing happens in the browser, where the commissioner can see what it
 * made of the paste before committing to it — so what arrives here is already
 * two boards. This checks they are shaped like boards and hands them on; the
 * function decides who may.
 */
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
  if (!Number.isInteger(week) || week < 1) {
    return Response.json({ error: "week must be a whole number" }, { status: 400 });
  }

  if (body?.remove === true) {
    const { error } = await db.rpc("unpublish_pylon_report", { p_week: week });
    if (error) return Response.json({ error: error.message }, { status: error.code === "42501" ? 403 : 409 });
    return Response.json({ ok: true, week });
  }

  const college = boardFrom(body?.college);
  const nfl = boardFrom(body?.nfl);
  if (!college.ranked.length && !nfl.ranked.length) {
    return Response.json({ error: "That report has nothing ranked in it" }, { status: 400 });
  }

  const { error } = await db.rpc("publish_pylon_report", {
    p_week: week,
    p_college: college,
    p_nfl: nfl,
  });

  if (error) {
    return Response.json(
      {
        error:
          error.code === "42P01" || error.code === "PGRST202"
            ? "The report is not in the database yet. Run supabase/all-migrations.sql."
            : error.message,
      },
      { status: error.code === "42501" ? 403 : 409 },
    );
  }

  return Response.json({ ok: true, week });
}

/**
 * A board, taken off the request rather than trusted from it.
 *
 * Whatever a browser sends ends up on twelve people's home screens, so each
 * field is read for what it should be and nothing else rides along.
 */
function boardFrom(raw: unknown): BoardReport {
  const from = (list: unknown): BoardReport["ranked"] =>
    (Array.isArray(list) ? list : [])
      .map((e) => {
        const row = e as { rank?: unknown; team?: unknown; record?: unknown; note?: unknown };
        return {
          rank: Number(row?.rank) || 0,
          team: String(row?.team ?? "").trim().slice(0, 80),
          record: String(row?.record ?? "").trim().slice(0, 12),
          // Long enough for a paragraph on a team, short enough that the
          // response stays a response.
          note: String(row?.note ?? "").trim().slice(0, 4000),
        };
      })
      .filter((e) => e.team && e.rank > 0)
      .slice(0, 40);

  const board = raw as { ranked?: unknown; honorable?: unknown } | null;
  return { ranked: from(board?.ranked), honorable: from(board?.honorable) };
}
