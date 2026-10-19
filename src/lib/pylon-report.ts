/**
 * The Pylon Report: the commissioner's own college and NFL rankings.
 *
 * Not computed from anything — this league's report is his opinion, written
 * down. The commissioner maintains each board directly (reorder, edit a
 * record, add or drop a team) in the office, and what is on screen when he
 * publishes is what goes out. There is no paste-and-parse step any more: the
 * board he's editing already is the board, so publishing is just saving its
 * current order.
 */

export type Board = "college" | "nfl";

/**
 * How deep each board runs. Per board rather than one number for both,
 * because the two are not the same size and never were the same thing:
 * thirty-two is every club in the NFL, and a college top twenty-five is a
 * choice out of a hundred and thirty.
 */
export const RANKED: Record<Board, number> = { college: 25, nfl: 32 };

/**
 * All thirty-two, for seeding the NFL board the first time it's edited.
 * Unlike the college board — a choice out of a hundred and thirty, built one
 * add at a time — there is no "add a team" for the NFL: every club is
 * already a club, so the list starts with all of them rather than empty.
 */
export const NFL_TEAMS: readonly string[] = [
  "Arizona Cardinals",
  "Atlanta Falcons",
  "Baltimore Ravens",
  "Buffalo Bills",
  "Carolina Panthers",
  "Chicago Bears",
  "Cincinnati Bengals",
  "Cleveland Browns",
  "Dallas Cowboys",
  "Denver Broncos",
  "Detroit Lions",
  "Green Bay Packers",
  "Houston Texans",
  "Indianapolis Colts",
  "Jacksonville Jaguars",
  "Kansas City Chiefs",
  "Las Vegas Raiders",
  "Los Angeles Chargers",
  "Los Angeles Rams",
  "Miami Dolphins",
  "Minnesota Vikings",
  "New England Patriots",
  "New Orleans Saints",
  "New York Giants",
  "New York Jets",
  "Philadelphia Eagles",
  "Pittsburgh Steelers",
  "San Francisco 49ers",
  "Seattle Seahawks",
  "Tampa Bay Buccaneers",
  "Tennessee Titans",
  "Washington Commanders",
];

export interface Entry {
  rank: number;
  team: string;
  /** "2-0". Empty when there isn't one yet. */
  record: string;
}

export interface BoardReport {
  /** The ranking, in order. Rank is implied by position, not stored twice. */
  ranked: Entry[];
  /**
   * Kept for reports published before the board became a maintained list
   * rather than a weekly paste — a season's worth of history still has rows
   * here. Nothing publishes into it any more.
   */
  honorable: Entry[];
}

/**
 * A team name as it survives being retyped.
 *
 * Case, spacing and punctuation go. What is left is enough to recognise the
 * same team across two different weeks' spelling of it, and not enough to
 * pretend two actually-different teams are the same one.
 */
export const keyOf = (team: string) =>
  team.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// ------------------------------------------------------------- the arrows ---

export type Move =
  | { kind: "new" }
  | { kind: "held" }
  | { kind: "up"; places: number }
  | { kind: "down"; places: number };

/**
 * How each team has moved since the week before.
 *
 * Measured across the ranking and the mentions together, not the ranking
 * alone: a team that was an honourable mention and is ranked this week has
 * moved a definite number of places, and calling that NEW would throw away the
 * only interesting thing about it.
 */
export function movement(now: BoardReport, before: BoardReport | null): Map<string, Move> {
  const out = new Map<string, Move>();
  // No report to compare against is not the same as every team being new. The
  // first week of a season would otherwise be a NEW badge on every row, which
  // says nothing and reads as a bug.
  if (!before) return out;

  const was = new Map([...before.ranked, ...before.honorable].map((e) => [keyOf(e.team), e.rank]));

  for (const e of [...now.ranked, ...now.honorable]) {
    const then = was.get(keyOf(e.team));
    if (then == null) out.set(keyOf(e.team), { kind: "new" });
    else if (then === e.rank) out.set(keyOf(e.team), { kind: "held" });
    else if (then > e.rank) out.set(keyOf(e.team), { kind: "up", places: then - e.rank });
    else out.set(keyOf(e.team), { kind: "down", places: e.rank - then });
  }

  return out;
}

/** What the arrow says out loud, for a screen reader. */
export function moveLabel(move: Move | undefined): string {
  if (!move) return "";
  if (move.kind === "new") return "New this week";
  if (move.kind === "held") return "Unchanged";
  return `${move.kind === "up" ? "Up" : "Down"} ${move.places} ${move.places === 1 ? "place" : "places"}`;
}

// -------------------------------------------------------- the national polls ---

/**
 * College only: the three polls everybody else goes by, alongside the
 * commissioner's own ranking rather than in place of it. These still arrive
 * as a paste — they're somebody else's publication, not a list he's
 * maintaining — a rank shared down the row, a team per poll.
 */
export type PollKey = "ap" | "coaches" | "cfp";
export interface PollEntry {
  rank: number;
  team: string;
}
export type Polls = Record<PollKey, PollEntry[]>;

const EMPTY_POLLS = (): Polls => ({ ap: [], coaches: [], cfp: [] });

/** Past this a row is not a rank. The polls never run deeper than 25. */
const MAX_POLL_RANK = 25;

/** Split a pasted row into cells: tabs first, then runs of spaces. */
export function cellsOf(line: string): string[] {
  const parts = line.includes("\t") ? line.split("\t") : line.split(/\s{2,}|\s*\|\s*/);
  return parts.map((c) => c.trim());
}

/** Which poll a header cell names, or null. */
function pollOf(cell: string): PollKey | null {
  const t = cell.toLowerCase();
  if (/\bap\b/.test(t)) return "ap";
  if (/coach/.test(t)) return "coaches";
  if (/\bcfp\b/.test(t) || /playoff/.test(t)) return "cfp";
  return null;
}

/**
 * Read the polls grid: a rank, then one team per poll. The sheet's own column
 * order unless a header names it — the order is the commissioner's to
 * change, not this file's to assume.
 */
export function parsePolls(text: string): { polls: Polls; ignored: string[] } {
  const polls = EMPTY_POLLS();
  const ignored: string[] = [];
  let order: PollKey[] = ["ap", "coaches", "cfp"];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const cells = cellsOf(line);
    const named = cells.map(pollOf).filter((p): p is PollKey => p != null);

    if (named.length && !/^\d/.test(cells[0] ?? "")) {
      order = named;
      continue;
    }

    const rank = Number((cells[0] ?? "").replace(/\.0+$/, ""));
    if (!Number.isInteger(rank) || rank < 1 || rank > MAX_POLL_RANK) {
      ignored.push(line);
      continue;
    }

    cells.slice(1).forEach((cell, i) => {
      const team = cell.trim();
      const key = order[i];
      if (team && key) polls[key].push({ rank, team });
    });
  }

  for (const key of Object.keys(polls) as PollKey[]) {
    polls[key].sort((a, z) => a.rank - z.rank);
  }

  return { polls, ignored };
}
