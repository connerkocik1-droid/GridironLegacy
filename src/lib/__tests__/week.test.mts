/**
 * Which week a page is looking at.
 *
 * Three routes used to answer "week one" whenever nobody told them otherwise,
 * which is correct for seven days a year. A manager opening their roster in
 * November was shown September, live, with a total that had not moved since.
 *
 * The rule is the league's, not the calendar's: the first fixture still to be
 * settled. A league graded late is still on the week it has not finished, and
 * a season that is over stays on its last week rather than rolling round to
 * one.
 */

import { currentWeek, weekFrom } from "../week";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}`}`);
  if (!pass) failed++;
};

/** Just enough of the client for the one query this makes. */
const db = (fixtures: { week: number; final: boolean }[]) =>
  ({
    from: () => ({
      select: () => ({
        eq: () => ({
          order: async () => ({ data: fixtures }),
        }),
      }),
    }),
  }) as never;

const req = (url: string) => new Request(url);

console.log("--- the week the league is on ---");

eq(
  "the first week not yet settled",
  await currentWeek(db([
    { week: 1, final: true },
    { week: 2, final: true },
    { week: 3, final: false },
    { week: 4, final: false },
  ]), "L"),
  3,
);

eq(
  "a week graded late does not drag the page back to the calendar",
  await currentWeek(db([
    { week: 1, final: false },
    { week: 2, final: true },
  ]), "L"),
  1,
);

eq(
  "a finished season stays on its last week",
  await currentWeek(db([
    { week: 16, final: true },
    { week: 17, final: true },
  ]), "L"),
  17,
);

eq("and a league with no fixtures at all is week one", await currentWeek(db([]), "L"), 1);

console.log("\n--- what a request asked for ---");

const played = [{ week: 1, final: true }, { week: 2, final: false }];

eq("an explicit week wins", await weekFrom(req("http://x/api?week=9"), db(played), "L"), 9);
eq("no week means the league's own", await weekFrom(req("http://x/api"), db(played), "L"), 2);
eq("an empty week means the same", await weekFrom(req("http://x/api?week="), db(played), "L"), 2);

// Not silently ignored: the caller answers with a 400 rather than showing a
// different week from the one somebody asked for.
eq("nonsense is refused", await weekFrom(req("http://x/api?week=soon"), db(played), "L"), null);
eq("and so is half a week", await weekFrom(req("http://x/api?week=2.5"), db(played), "L"), null);

// A week outside the season is a real question — the schedule page links to
// every week there is — so it is passed through and answered with an empty
// fixture rather than rejected.
eq("a week nobody has played is passed through", await weekFrom(req("http://x/api?week=18"), db(played), "L"), 18);

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
