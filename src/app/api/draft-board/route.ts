import type { ProspectBoard } from "@/lib/pylon-draft-board";
import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

interface Row {
  week: number;
  board: ProspectBoard;
}

/** The latest published big board, so the desk has a list to start editing from. */
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
    .select("league_id")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  const { data, error } = await db
    .from("pylon_draft_boards")
    .select("week, board")
    .eq("league_id", me.league_id)
    .order("week", { ascending: false })
    .limit(1);

  if (error) {
    // The table arrives with migration 0061, same race as pylon_reports.
    console.warn("[draft-board] no draft boards table yet", error.message);
    return Response.json({ board: null });
  }

  const row = ((data ?? [])[0] ?? null) as Row | null;
  return Response.json({ board: row?.board ?? null, week: row?.week ?? null });
}

/**
 * Publish a week's big board.
 *
 * Same shape as POST /api/report: the desk sends the board as it stands on
 * screen. This checks it is shaped like a board and hands it on; the
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
    const { error } = await db.rpc("unpublish_pylon_draft_board", { p_week: week });
    if (error) return Response.json({ error: error.message }, { status: error.code === "42501" ? 403 : 409 });
    return Response.json({ ok: true, week });
  }

  const board = boardFrom(body?.board);
  if (!board.ranked.length) {
    return Response.json({ error: "That big board has nothing ranked in it" }, { status: 400 });
  }

  const { error } = await db.rpc("publish_pylon_draft_board", {
    p_week: week,
    p_board: board,
  });

  if (error) {
    return Response.json(
      {
        error:
          error.code === "42P01" || error.code === "PGRST202"
            ? "The big board is not in the database yet. Run supabase/all-migrations.sql."
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
 * Whatever a browser sends ends up on a public page, so each field is read
 * for what it should be and nothing else rides along.
 */
function boardFrom(raw: unknown): ProspectBoard {
  const from = (list: unknown): ProspectBoard["ranked"] =>
    (Array.isArray(list) ? list : [])
      .map((e) => {
        const row = e as { rank?: unknown; player?: unknown; position?: unknown; college?: unknown };
        return {
          rank: Number(row?.rank) || 0,
          player: String(row?.player ?? "").trim().slice(0, 80),
          position: String(row?.position ?? "").trim().slice(0, 6),
          college: String(row?.college ?? "").trim().slice(0, 80),
        };
      })
      .filter((e) => e.player && e.rank > 0)
      .slice(0, 80);

  const board = raw as { ranked?: unknown; honorable?: unknown } | null;
  return { ranked: from(board?.ranked), honorable: from(board?.honorable) };
}
