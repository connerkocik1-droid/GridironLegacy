import PylonReportPage from "@/components/PylonReportPage";
import { movement, type BoardReport, type Move, type Polls } from "@/lib/pylon-report";
import { prospectMovement, type ProspectBoard } from "@/lib/pylon-draft-board";
import { isConfigured, serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "The Pylon Report · Pylon Fantasy",
  description: "This week's college and NFL rankings, and the 2027 big board.",
};

interface ReportRow {
  week: number;
  college: BoardReport & { polls?: Polls };
  nfl: BoardReport;
  published_at: string;
}

interface DraftBoardRow {
  week: number;
  board: ProspectBoard;
  published_at: string;
}

const EMPTY_BOARD: BoardReport = { ranked: [], honorable: [] };
const EMPTY_POLLS: Polls = { ap: [], coaches: [], cfp: [] };
const EMPTY_PROSPECTS: ProspectBoard = { ranked: [], honorable: [] };

/**
 * The public Pylon Report, no sign-in needed — the same way the sign-in page
 * itself reads the league with the service client rather than a session,
 * because there isn't one yet. This page has the same shape of absence: a
 * visitor who has never logged in is exactly who it's for.
 */
async function load() {
  if (!isConfigured() || !process.env.LEAGUE_ID) return null;

  try {
    const db = serviceClient();
    const { data, error } = await db
      .from("pylon_reports")
      .select("week, college, nfl, published_at")
      .eq("league_id", process.env.LEAGUE_ID)
      .order("week", { ascending: false })
      .limit(2);
    if (error) throw error;

    const { data: boardData, error: boardError } = await db
      .from("pylon_draft_boards")
      .select("week, board, published_at")
      .eq("league_id", process.env.LEAGUE_ID)
      .order("week", { ascending: false })
      .limit(2);

    const rows = (data ?? []) as ReportRow[];
    const now = rows[0] ?? null;
    const before = rows[1] ?? null;

    const boardRows = boardError ? [] : ((boardData ?? []) as DraftBoardRow[]);
    const nowBoard = boardRows[0] ?? null;
    const beforeBoard = boardRows[1] ?? null;

    return {
      week: now?.week ?? null,
      publishedAt: now?.published_at ?? null,
      college: now?.college ?? EMPTY_BOARD,
      nfl: now?.nfl ?? EMPTY_BOARD,
      polls: now?.college?.polls ?? EMPTY_POLLS,
      collegeMoves: movement(now?.college ?? EMPTY_BOARD, before?.college ?? null),
      nflMoves: movement(now?.nfl ?? EMPTY_BOARD, before?.nfl ?? null),
      bigBoard: nowBoard?.board ?? EMPTY_PROSPECTS,
      bigBoardWeek: nowBoard?.week ?? null,
      bigBoardMoves: prospectMovement(nowBoard?.board ?? EMPTY_PROSPECTS, beforeBoard?.board ?? null),
    };
  } catch {
    return null;
  }
}

function asObject(moves: Map<string, Move>): Record<string, Move> {
  return Object.fromEntries(moves);
}

export default async function PylonReportRoute() {
  const data = await load();

  return (
    <PylonReportPage
      week={data?.week ?? null}
      publishedAt={data?.publishedAt ?? null}
      college={data?.college ?? EMPTY_BOARD}
      nfl={data?.nfl ?? EMPTY_BOARD}
      polls={data?.polls ?? EMPTY_POLLS}
      collegeMoves={asObject(data?.collegeMoves ?? new Map())}
      nflMoves={asObject(data?.nflMoves ?? new Map())}
      bigBoard={data?.bigBoard ?? EMPTY_PROSPECTS}
      bigBoardWeek={data?.bigBoardWeek ?? null}
      bigBoardMoves={asObject(data?.bigBoardMoves ?? new Map())}
    />
  );
}
