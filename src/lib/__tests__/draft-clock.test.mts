/**
 * The pick clock, which is a ladder rather than a number.
 *
 * The league's rule is the thing being checked: ninety seconds through round
 * four, seventy-five through ten, sixty from eleven on. The boundaries are
 * where this goes wrong — a tier that covers "through round 4" has to include
 * round four and exclude round five, and an off-by-one either way is a whole
 * round drafted on the wrong clock with nobody noticing until it has passed.
 *
 * The other half is what happens to a settings blob nobody validated. This is
 * read on the path that makes a pick, so every malformed shape below has to
 * come back with a usable number rather than a throw.
 */

import {
  DEFAULT_PICK_CLOCK,
  describeClock,
  pickSecondsFor,
  readPickClock,
  tierRounds,
} from "../draft-clock";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!pass) failed++;
};
const ok = (label: string, got: boolean) => {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  if (!got) failed++;
};

console.log("--- the league's own ladder ---");

const league = readPickClock({
  pickClock: [
    { throughRound: 4, seconds: 90 },
    { throughRound: 10, seconds: 75 },
    { throughRound: null, seconds: 60 },
  ],
});

eq("round 1 gets ninety", pickSecondsFor(league, 1), 90);
eq("and so does round 4", pickSecondsFor(league, 4), 90);
eq("round 5 drops to seventy-five", pickSecondsFor(league, 5), 75);
eq("and holds there through 10", pickSecondsFor(league, 10), 75);
eq("round 11 drops to sixty", pickSecondsFor(league, 11), 60);
eq("and stays there however deep the draft runs", pickSecondsFor(league, 40), 60);

// The default is the league's rule, so a league that has never been told
// anything runs the same clock as one that has.
eq("the default is that same ladder", readPickClock({}), DEFAULT_PICK_CLOCK);
eq("  through round 4", pickSecondsFor(DEFAULT_PICK_CLOCK, 4), 90);
eq("  round 5", pickSecondsFor(DEFAULT_PICK_CLOCK, 5), 75);
eq("  round 11", pickSecondsFor(DEFAULT_PICK_CLOCK, 11), 60);

console.log("\n--- a round nobody planned for ---");

// Every tier stated, none of them open-ended: a draft that runs past the last
// one must not find it has no clock at all.
const closed = readPickClock({
  pickClock: [
    { throughRound: 2, seconds: 90 },
    { throughRound: 4, seconds: 60 },
  ],
});
eq("falls to the last tier rather than to nothing", pickSecondsFor(closed, 9), 60);
ok("and never returns zero", pickSecondsFor(closed, 99) > 0);

eq("round 0 is treated as round 1", pickSecondsFor(league, 0), 90);
eq("so is a missing round", pickSecondsFor(league, null), 90);
eq("and a nonsense one", pickSecondsFor(league, Number.NaN), 90);

console.log("\n--- a league from before the ladder existed ---");

const legacy = readPickClock({ pickSeconds: 120 });
eq("its one number covers every round", legacy, [{ throughRound: null, seconds: 120 }]);
eq("round 1", pickSecondsFor(legacy, 1), 120);
eq("round 14", pickSecondsFor(legacy, 14), 120);

console.log("\n--- settings nobody validated ---");

eq("no settings at all", readPickClock(null), DEFAULT_PICK_CLOCK);
eq("a pickClock that is not a list", readPickClock({ pickClock: "90" }), DEFAULT_PICK_CLOCK);
eq("an empty list", readPickClock({ pickClock: [] }), DEFAULT_PICK_CLOCK);
eq(
  "a list of nothing usable",
  readPickClock({ pickClock: [null, 7, { seconds: "soon" }] }),
  DEFAULT_PICK_CLOCK,
);

// One bad rung does not throw the ladder away.
eq(
  "a bad tier is skipped and the rest kept",
  readPickClock({
    pickClock: [
      { throughRound: 3, seconds: 0 },
      { throughRound: 6, seconds: 45 },
      { throughRound: null, seconds: 30 },
    ],
  }),
  [
    { throughRound: 6, seconds: 45 },
    { throughRound: null, seconds: 30 },
  ],
);

eq(
  "an absurdly short clock is clamped, not honoured",
  readPickClock({ pickClock: [{ throughRound: null, seconds: 1 }] })[0].seconds,
  5,
);
eq(
  "and an absurdly long one",
  readPickClock({ pickClock: [{ throughRound: null, seconds: 99999 }] })[0].seconds,
  600,
);
eq("a pickSeconds of zero is not a clock", readPickClock({ pickSeconds: 0 }), DEFAULT_PICK_CLOCK);

console.log("\n--- how it reads ---");

eq("the first tier counts from round one", tierRounds(DEFAULT_PICK_CLOCK, 0), "Rounds 1–4");
eq("the middle one from where the last ended", tierRounds(DEFAULT_PICK_CLOCK, 1), "Rounds 5–10");
eq("and the open one has no end", tierRounds(DEFAULT_PICK_CLOCK, 2), "Round 11 on");
eq(
  "a tier covering one round says so",
  tierRounds([{ throughRound: 1, seconds: 90 }, { throughRound: null, seconds: 60 }], 0),
  "Round 1",
);
eq(
  "a single open tier covers everything",
  tierRounds([{ throughRound: null, seconds: 90 }], 0),
  "Every round",
);
eq(
  "the whole clock in one line",
  describeClock(DEFAULT_PICK_CLOCK),
  "Rounds 1–4: 90s · Rounds 5–10: 75s · Round 11 on: 60s",
);

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
