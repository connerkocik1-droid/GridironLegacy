/**
 * A backfill runs once, against production, over records somebody is looking
 * at. Refusing a request nobody meant is worth more than being accommodating,
 * so the refusals are what is tested.
 */
import { MAX_PER_RUN, plan } from "../backfill";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}`}`);
  if (!pass) failed++;
};
const q = (s: string) => new URLSearchParams(s);

console.log("--- one week ---");
eq("named on its own", plan(q("week=2"), 5).weeks, [2]);
eq("and nothing is left over", plan(q("week=2"), 5).remaining, []);

console.log("\n--- a range ---");
eq("inclusive of both ends", plan(q("from=1&to=3"), 5).weeks, [1, 2, 3]);
eq("open at the end means as far as the season has got",
  plan(q("from=2"), 4).weeks, [2, 3, 4]);
eq("open at the start means from week one", plan(q("to=2"), 9).weeks, [1, 2]);

console.log("\n--- nothing named ---");
eq("is every week played", plan(q(""), 3).weeks, [1, 2, 3]);

console.log("\n--- and a run has a size ---");
{
  // Sixteen games a week, several requests each. One HTTP request cannot
  // re-score a season before the platform stops listening, so it says what it
  // did not get to rather than dying half way and reporting success.
  const big = plan(q("from=1&to=10"), 10);
  eq(`at most ${MAX_PER_RUN} a run`, big.weeks.length, MAX_PER_RUN);
  eq("the first of them", big.weeks[0], 1);
  eq("and the rest are named so the caller knows to go again",
    big.remaining, [5, 6, 7, 8, 9, 10]);
}

console.log("\n--- what it refuses ---");
eq("a week that is not a number", plan(q("week=soon"), 5).error, "week must be a positive integer");
eq("a week before the season", plan(q("week=0"), 5).error, "week must be a positive integer");
eq("a negative week", plan(q("week=-2"), 5).error, "week must be a positive integer");
eq("a range the wrong way round", plan(q("from=5&to=2"), 9).error, "to must not be before from");
eq("a week and a range at once", plan(q("week=2&from=1"), 9).error,
  "Name a week, or a range, but not both");
eq("and a season that has not started", plan(q(""), 0).error, "No weeks have been played yet");

// A refusal must not also do something.
eq("a refusal touches no weeks", plan(q("from=5&to=2"), 9).weeks, []);

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
