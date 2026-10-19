import PylonReportPage from "@/components/PylonReportPage";
import { keyOf, type BoardReport, type Polls } from "@/lib/pylon-report";
import { weeklyValues } from "@/lib/pylon-report-view";
import type { ProspectBoard, ProspectEntry } from "@/lib/pylon-draft-board";
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
const EMPTY_LOGOS: Record<string, string> = {};

/**
 * The public Pylon Report, no sign-in needed — the same way the sign-in page
 * itself reads the league with the service client rather than a session,
 * because there isn't one yet. This page has the same shape of absence: a
 * visitor who has never logged in is exactly who it's for.
 *
 * Four weeks are read rather than two: the sparkline trails need real
 * history, and the simplest source of it is just the last four published
 * boards, the same rows movement() already reads two of.
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
      .limit(4);
    if (error) throw error;

    const { data: boardData, error: boardError } = await db
      .from("pylon_draft_boards")
      .select("week, board, published_at")
      .eq("league_id", process.env.LEAGUE_ID)
      .order("week", { ascending: false })
      .limit(4);

    const { data: logoData } = await db
      .from("report_logos")
      .select("scope, abbr, image")
      .eq("league_id", process.env.LEAGUE_ID);

    const rows = (data ?? []) as ReportRow[];
    const now = rows[0] ?? null;
    const before = rows[1] ?? null;
    const oldestFirst = rows.slice().reverse();

    const boardRows = boardError ? [] : ((boardData ?? []) as DraftBoardRow[]);
    const nowBoard = boardRows[0] ?? null;
    const beforeBoard = boardRows[1] ?? null;
    const boardOldestFirst = boardRows.slice().reverse();

    const cfbLogos: Record<string, string> = {};
    const nflLogos: Record<string, string> = {};
    for (const row of logoData ?? []) {
      if (row.scope === "cfb") cfbLogos[row.abbr] = row.image;
      else if (row.scope === "nfl") nflLogos[row.abbr] = row.image;
    }

    return {
      week: now?.week ?? null,
      publishedAt: now?.published_at ?? null,
      college: now?.college ?? EMPTY_BOARD,
      collegeBefore: before?.college ?? null,
      nfl: now?.nfl ?? EMPTY_BOARD,
      nflBefore: before?.nfl ?? null,
      polls: now?.college?.polls ?? EMPTY_POLLS,
      collegeHistory: weeklyValues(
        oldestFirst.map((r) => r.college ?? EMPTY_BOARD),
        (e) => keyOf(e.team),
        (e) => e.rank,
      ),
      nflHistory: weeklyValues(
        oldestFirst.map((r) => r.nfl ?? EMPTY_BOARD),
        (e) => keyOf(e.team),
        (e) => e.rank,
      ),
      bigBoard: nowBoard?.board ?? EMPTY_PROSPECTS,
      bigBoardBefore: beforeBoard?.board ?? null,
      bigBoardWeek: nowBoard?.week ?? null,
      bigBoardHistory: weeklyValues(
        boardOldestFirst.map((r) => r.board ?? EMPTY_PROSPECTS),
        (e: ProspectEntry) => keyOf(e.player),
        (e: ProspectEntry) => e.rating,
      ),
      cfbLogos,
      nflLogos,
    };
  } catch {
    return null;
  }
}

export default async function PylonReportRoute() {
  const data = await load();

  return (
    <PylonReportPage
      week={data?.week ?? null}
      college={data?.college ?? EMPTY_BOARD}
      collegeBefore={data?.collegeBefore ?? null}
      collegeHistory={data?.collegeHistory ?? {}}
      polls={data?.polls ?? EMPTY_POLLS}
      nfl={data?.nfl ?? EMPTY_BOARD}
      nflBefore={data?.nflBefore ?? null}
      nflHistory={data?.nflHistory ?? {}}
      bigBoard={data?.bigBoard ?? EMPTY_PROSPECTS}
      bigBoardBefore={data?.bigBoardBefore ?? null}
      bigBoardWeek={data?.bigBoardWeek ?? null}
      bigBoardHistory={data?.bigBoardHistory ?? {}}
      cfbLogos={data?.cfbLogos ?? EMPTY_LOGOS}
      nflLogos={data?.nflLogos ?? EMPTY_LOGOS}
    />
  );
}
