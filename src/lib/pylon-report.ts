/**
 * The Pylon Report: a week's college and NFL rankings, pasted in whole.
 *
 * Built around what the commissioner actually has in front of him rather than
 * a format invented here. That turns out to be two documents:
 *
 * A spreadsheet, two boards side by side — a rank, a team and a record per
 * column pair. College runs to twenty-five and the NFL to thirty-two, which is
 * every club in the league; anything pasted past those is taken as an
 * honourable mention, the way the first version of this board worked when it
 * ran fifteen deep with five behind it. Nothing is labelled as such in the
 * sheet: a mention is simply a row past the end of the ranking.
 *
 * And a write-up, one paragraph per team: "Baltimore Ravens - Lamar Jackson
 * looked great…", in ranking order.
 *
 * So the two are pasted separately and joined here on the team's name. The
 * joining is the part that needs care: the sheet says "Cincinatti Bengals" and
 * the write-up says "Cincinnati Bengals", and a join that silently drops the
 * difference loses a breakdown without saying so. Names are matched on a
 * forgiving key, and whatever is left over is handed back so the office can
 * show it rather than swallow it.
 */

export type Board = "college" | "nfl";

/**
 * How deep each board's ranking runs, past which a row is an honourable
 * mention.
 *
 * Per board rather than one number for both, because the two are not the same
 * size and never were the same thing: thirty-two is every club in the NFL, so
 * that board cannot have a mention at all, while a college top twenty-five is
 * a choice out of a hundred and thirty and may well have some behind it.
 */
export const RANKED: Record<Board, number> = { college: 25, nfl: 32 };

/** Past this a row is not a rank, it is a stray number in the paste. */
const MAX_RANK = 60;

export interface Entry {
  rank: number;
  team: string;
  /** "2-0". Empty when the sheet did not have one, or mangled it. */
  record: string;
  /** The write-up. Empty until the breakdowns are pasted in. */
  note: string;
}

export interface BoardReport {
  /** The ranking proper — 1 to 25 for college, 1 to 32 for the NFL. */
  ranked: Entry[];
  /** Anything pasted past the end of the ranking, in order. */
  honorable: Entry[];
}

export interface ParsedReport {
  college: BoardReport;
  nfl: BoardReport;
  /** Grid lines that carried no readable rank. */
  ignored: string[];
}

const EMPTY = (): BoardReport => ({ ranked: [], honorable: [] });

/**
 * A record, or nothing.
 *
 * Excel reads "2-0" as the second of October and hands back a date serial, so
 * a column of records arrives as "2-0", "1-0" and "46023" in the same paste.
 * A number that large is not a record and printing it would be worse than
 * printing nothing, so anything that is not two or three numbers joined by
 * dashes is dropped.
 */
export function readRecord(cell: string): string {
  const t = (cell ?? "").trim();
  return /^\d{1,2}-\d{1,2}(-\d{1,2})?$/.test(t) ? t : "";
}

/** Split a pasted row into cells: tabs first, then runs of spaces. */
function cellsOf(line: string): string[] {
  const parts = line.includes("\t") ? line.split("\t") : line.split(/\s{2,}|\s*\|\s*/);
  return parts.map((c) => c.trim());
}

/** Which board a header cell names, or null. */
function boardOf(cell: string): Board | null {
  const t = cell.toLowerCase();
  if (t.includes("college") || /\bcfb\b/.test(t) || /\bncaa\b/.test(t)) return "college";
  if (/\bnfl\b/.test(t) || t.includes("pro football")) return "nfl";
  return null;
}

/**
 * Read the rankings grid.
 *
 * A row is a rank followed by pairs of team and record. Two pairs is the sheet
 * as it is kept — college then NFL — and one pair is a single board, which is
 * what a paste of half the sheet looks like. A header row naming the boards is
 * read when it is there rather than assumed, because the order is the
 * commissioner's to change.
 */
export function parseRankings(text: string): ParsedReport {
  const college = EMPTY();
  const nfl = EMPTY();
  const ignored: string[] = [];

  // Which board each column pair belongs to. The sheet's own order unless a
  // header says otherwise.
  let order: Board[] = ["college", "nfl"];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const cells = cellsOf(line);
    const named = cells.map(boardOf).filter((b): b is Board => b != null);

    // A header row: no rank on it, and it names at least one board.
    if (named.length && !/^\d/.test(cells[0] ?? "")) {
      order = named.length === 1 ? [named[0]] : named;
      continue;
    }

    // Excel writes a whole-number cell as "1.0". The rank is the integer.
    const rank = Number((cells[0] ?? "").replace(/\.0+$/, ""));
    if (!Number.isInteger(rank) || rank < 1 || rank > MAX_RANK) {
      ignored.push(line);
      continue;
    }

    // Everything after the rank, in pairs. A trailing team with no record is
    // still a team: the last column is often left empty.
    const rest = cells.slice(1);
    for (let pair = 0; pair * 2 < rest.length; pair++) {
      const team = (rest[pair * 2] ?? "").trim();
      if (!team) continue;

      const board = order[pair] ?? (pair === 0 ? "college" : "nfl");
      const into = board === "college" ? college : nfl;
      const entry: Entry = {
        rank,
        team,
        record: readRecord(rest[pair * 2 + 1] ?? ""),
        note: "",
      };
      (rank <= RANKED[board] ? into.ranked : into.honorable).push(entry);
    }
  }

  for (const b of [college, nfl]) {
    b.ranked.sort((a, z) => a.rank - z.rank);
    b.honorable.sort((a, z) => a.rank - z.rank);
  }

  return { college, nfl, ignored };
}

// ------------------------------------------------------------ the write-up ---

export interface Breakdown {
  team: string;
  note: string;
}

/**
 * Read the write-up: one paragraph per team, "Team - what happened".
 *
 * A heading — a short line with no separator in it — switches board when it
 * names one, and is otherwise skipped. A paragraph that wraps belongs to the
 * team above it.
 */
export function parseBreakdowns(text: string): { college: Breakdown[]; nfl: Breakdown[] } {
  const out = { college: [] as Breakdown[], nfl: [] as Breakdown[] };
  let board: Board = "nfl";
  let named = false;
  let last: Breakdown | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      last = null;
      continue;
    }

    const split = splitNamed(line);

    if (!split) {
      const heading = boardOf(line);
      if (heading) {
        board = heading;
        named = true;
        last = null;
        continue;
      }
      // Not a heading and not a new team: the rest of the last paragraph.
      if (last) last.note = `${last.note} ${line}`.trim();
      continue;
    }

    // A line that names a board and a team both — "NFL Post Week 1 Report" has
    // no separator so it never gets here, but "NFL - week one" would.
    const heading = boardOf(split.team);
    if (heading && !split.note.includes(" ")) {
      board = heading;
      named = true;
      last = null;
      continue;
    }

    last = { team: split.team, note: split.note };
    out[board].push(last);
  }

  // A write-up with no heading at all is one board's. Which one is the
  // caller's to say — it knows which box was pasted into.
  if (!named && out.nfl.length && !out.college.length) return out;
  return out;
}

/**
 * Split "Baltimore Ravens - Lamar Jackson looked great" into the two.
 *
 * The separator is an em or en dash, or a hyphen, with spaces around it. A
 * hyphen without spaces stays in the name: Ole Miss is not "Ole", and neither
 * is a record of 2-0 a breakdown.
 */
function splitNamed(line: string): { team: string; note: string } | null {
  const at = line.search(/\s+[—–-]\s+|:\s+/);
  if (at < 0) return null;

  const sep = line.slice(at).match(/^(\s+[—–-]\s+|:\s+)/);
  const team = line.slice(0, at).trim();
  const note = line.slice(at + (sep?.[0].length ?? 0)).trim();

  // A team's name is a few words. A whole sentence before the dash is prose
  // that happens to contain one.
  if (!team || !note || team.split(/\s+/).length > 6) return null;
  return { team, note };
}

// --------------------------------------------------------------- the join ---

/**
 * A team name as it survives being retyped.
 *
 * Case, spacing and punctuation go. What is left is enough to join a sheet to
 * a write-up typed on a different day, and not enough to join two teams that
 * are actually different — "Cincinatti" and "Cincinnati" stay apart, and the
 * office says so rather than this pretending to know what was meant.
 */
export const keyOf = (team: string) =>
  team.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Put the write-ups onto the ranking, and say which ones found nobody.
 *
 * Unmatched names are the whole reason this returns anything but a report: a
 * breakdown that quietly fails to land is a paragraph the commissioner wrote
 * and nobody reads.
 */
export function joinBreakdowns(
  board: BoardReport,
  breakdowns: Breakdown[],
): { board: BoardReport; unmatched: string[] } {
  const byKey = new Map(breakdowns.map((b) => [keyOf(b.team), b]));
  const used = new Set<string>();

  const place = (e: Entry): Entry => {
    const found = byKey.get(keyOf(e.team));
    if (!found) return e;
    used.add(keyOf(e.team));
    return { ...e, note: found.note };
  };

  return {
    board: { ranked: board.ranked.map(place), honorable: board.honorable.map(place) },
    unmatched: breakdowns.filter((b) => !used.has(keyOf(b.team))).map((b) => b.team),
  };
}

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

/** What a paste amounts to, for the preview before it is published. */
export function summarise(report: ParsedReport, unmatched: string[] = []): string {
  const part = (label: string, b: BoardReport) =>
    `${label} ${b.ranked.length}+${b.honorable.length}`;
  const bits = [part("College", report.college), part("NFL", report.nfl)];
  if (report.ignored.length) bits.push(`${report.ignored.length} unread`);
  if (unmatched.length) bits.push(`${unmatched.length} write-ups unmatched`);
  return bits.join(" · ");
}
