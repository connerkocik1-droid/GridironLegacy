/**
 * The schedule mirror, before and after the SQL that goes with it.
 *
 * mirrorSchedule now writes each game's quarter and clock, into two columns
 * that migration 0062 adds. A deploy can reach production before its SQL does,
 * and until then the database refuses any row that names a column it does not
 * have. A mirror that stops updating strands every game's state — the week
 * never goes live, scores stop moving — so the row has to go in without the
 * two new fields rather than not at all.
 */

import { mirrorSchedule } from "../live";
import type { Game } from "../espn";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}`}`);
  if (!pass) failed++;
};

const team = (abbrev: string, score: number) =>
  ({ abbrev, name: abbrev, score, homeAway: "home", winner: false, logo: "" }) as Game["home"];

const LIVE: Game = {
  id: "401",
  date: "2026-09-27T17:00:00Z",
  week: 3,
  seasonType: 2,
  state: "in",
  completed: false,
  statusDetail: "3rd Quarter · 7:56",
  home: team("NE", 17),
  away: team("SEA", 21),
  situation: null,
  period: 3,
  clock: 476,
};
const DONE: Game = { ...LIVE, id: "402", state: "post", completed: true, period: null, clock: null };

/** A database stand-in that records every upsert and answers from a script. */
function fakeDb(answers: ({ message: string; details?: string } | null)[]) {
  const calls: Record<string, unknown>[][] = [];
  const db = {
    from: () => ({
      upsert: async (rows: Record<string, unknown>[]) => {
        calls.push(rows);
        return { error: answers[calls.length - 1] ?? null };
      },
    }),
  };
  return { db: db as unknown as Parameters<typeof mirrorSchedule>[0], calls };
}

console.log("--- a database that has run 0062 ---");
{
  const { db, calls } = fakeDb([null]);
  await mirrorSchedule(db, [LIVE, DONE], 2026);
  eq("one write", calls.length, 1);
  eq("a game in progress keeps its quarter and clock", [calls[0][0].period, calls[0][0].clock], [3, 476]);
  eq("a finished game keeps neither", [calls[0][1].period, calls[0][1].clock], [null, null]);
}

console.log("\n--- one that has not ---");
{
  const { db, calls } = fakeDb([
    { message: "Could not find the 'clock' column of 'nfl_games' in the schema cache" },
    null,
  ]);
  await mirrorSchedule(db, [LIVE, DONE], 2026);
  eq("the refused write is tried again", calls.length, 2);
  eq("without the two new fields", calls[1].map((r) => "period" in r || "clock" in r), [false, false]);
  // The finished game ended 21-17 to the visitors, and the retry still says so.
  eq("and with everything else", [calls[1][0].id, calls[1][0].state, calls[1][1].winner], ["401", "in", "SEA"]);
}

console.log("\n--- and a failure that has nothing to do with it ---");
{
  const { db, calls } = fakeDb([{ message: "permission denied for table nfl_games" }]);
  const quiet = console.error;
  console.error = () => {};
  await mirrorSchedule(db, [LIVE], 2026);
  console.error = quiet;
  eq("is not retried as if it were", calls.length, 1);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
