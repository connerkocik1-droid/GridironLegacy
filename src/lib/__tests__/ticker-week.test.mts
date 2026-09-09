import { stepsBack } from "../../app/api/scoreboard/route";

/**
 * Which slate the ticker falls back to when nothing on this one has kicked off.
 *
 * The rule that matters is the one it must not break: never back across the
 * start of the season. On the Wednesday before the opener the ticker was
 * showing August preseason friendlies, because week 1 had no results yet and
 * the walk-back kept going until it found some.
 */

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}`}`);
  if (!pass) failed++;
};
const ok = (label: string, got: boolean) => {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  if (!got) failed++;
};

console.log("--- where the ticker looks next ---");

// The case this exists for. Nothing to walk back to, so the caller keeps the
// week 1 slate it already has — fixtures and kickoff times, which is what the
// week ahead looks like.
eq("regular-season week 1 has nowhere earlier to go", stepsBack({ seasonType: 2, week: 1 }), []);

ok("and never reaches into the preseason",
  stepsBack({ seasonType: 2, week: 1 }).every((s) => s.seasonType === 2));

eq("mid-season it tries the week before", stepsBack({ seasonType: 2, week: 5 })[0],
  { seasonType: 2, week: 4 });

eq("newest first", stepsBack({ seasonType: 2, week: 5 }).map((s) => s.week), [4, 3, 2, 1]);

ok("every step stays in the season it started in",
  stepsBack({ seasonType: 2, week: 9 }).every((s) => s.seasonType === 2));

// Five is enough to cross a bye and a quiet fortnight; walking the whole
// season back is a request per week to an API that is neither fast nor ours.
ok("it does not walk the whole season back", stepsBack({ seasonType: 2, week: 18 }).length <= 5);

console.log("\n--- and inside the preseason, the same rule ---");
{
  eq("preseason week 1 has nowhere to go", stepsBack({ seasonType: 1, week: 1 }), []);
  eq("preseason week 3 tries two and one",
    stepsBack({ seasonType: 1, week: 3 }).map((s) => s.week), [2, 1]);
  ok("staying in the preseason", stepsBack({ seasonType: 1, week: 3 }).every((s) => s.seasonType === 1));
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
