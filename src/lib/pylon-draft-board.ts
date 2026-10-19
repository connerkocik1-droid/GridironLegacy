/**
 * The Pylon Report's third board: the 2027 rookie draft big board.
 *
 * Same idea as the college and NFL boards in pylon-report.ts — the
 * commissioner's own list, maintained directly rather than pasted fresh each
 * week — reusing that file's team-name key so a prospect is recognised the
 * same forgiving way a team is.
 *
 * The one place a paste still happens: there's no prior week to carry
 * forward the first time this runs, so parseBigBoard reads a one-time bulk
 * paste to seed the first fifty. After that the commissioner edits the list
 * directly and this parser has no more callers.
 */

import { cellsOf, keyOf, type Move } from "./pylon-report";

export const BIG_BOARD_RANKED = 50;

/** Past this a row is not a rank, it is a stray number in the paste. */
const MAX_RANK = 300;

export interface ProspectEntry {
  rank: number;
  player: string;
  /** "QB", "EDGE", … — whatever the sheet called it, upper-cased. */
  position: string;
  college: string;
}

export interface ProspectBoard {
  /** The ranking proper — 1 to 50. */
  ranked: ProspectEntry[];
  /** Kept for a board published before this was a maintained list. */
  honorable: ProspectEntry[];
}

export interface ParsedBigBoard {
  board: ProspectBoard;
  /** Grid lines that carried no readable rank or no name. */
  ignored: string[];
}

const EMPTY = (): ProspectBoard => ({ ranked: [], honorable: [] });

/**
 * Read the big board grid, for the one-time seed: rank, player, position,
 * college — one prospect per row.
 */
export function parseBigBoard(text: string): ParsedBigBoard {
  const board = EMPTY();
  const ignored: string[] = [];

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    const cells = cellsOf(line);

    // Excel writes a whole-number cell as "1.0". The rank is the integer.
    const rank = Number((cells[0] ?? "").replace(/\.0+$/, ""));
    const player = (cells[1] ?? "").trim();
    if (!Number.isInteger(rank) || rank < 1 || rank > MAX_RANK || !player) {
      ignored.push(line);
      continue;
    }

    const entry: ProspectEntry = {
      rank,
      player,
      position: (cells[2] ?? "").trim().toUpperCase().slice(0, 6),
      college: (cells[3] ?? "").trim(),
    };
    (rank <= BIG_BOARD_RANKED ? board.ranked : board.honorable).push(entry);
  }

  board.ranked.sort((a, z) => a.rank - z.rank);
  board.honorable.sort((a, z) => a.rank - z.rank);

  return { board, ignored };
}

/** How each prospect has moved since the board was last published. See movement(). */
export function prospectMovement(now: ProspectBoard, before: ProspectBoard | null): Map<string, Move> {
  const out = new Map<string, Move>();
  if (!before) return out;

  const was = new Map([...before.ranked, ...before.honorable].map((e) => [keyOf(e.player), e.rank]));

  for (const e of [...now.ranked, ...now.honorable]) {
    const then = was.get(keyOf(e.player));
    if (then == null) out.set(keyOf(e.player), { kind: "new" });
    else if (then === e.rank) out.set(keyOf(e.player), { kind: "held" });
    else if (then > e.rank) out.set(keyOf(e.player), { kind: "up", places: then - e.rank });
    else out.set(keyOf(e.player), { kind: "down", places: e.rank - then });
  }

  return out;
}
