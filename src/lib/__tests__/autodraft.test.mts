/**
 * What gets drafted for somebody who is not drafting.
 *
 * The queue is settled in SQL, inside the transaction that makes the pick,
 * because it has to be read against who is still available at that instant.
 * This is the other half — what to take when the queue is empty — and the
 * thing worth checking is that it is not "best left by ADP". That answer
 * drafts a fourth quarterback in the ninth round and finishes the night
 * without a kicker, and it is what this league had until now.
 *
 * And separately: whether a pick is due at all. Two conditions rather than
 * one, and the difference between them matters — "nobody is home" waits for a
 * clock, "I told you I would not be here" does not.
 */

import { autodraftPick } from "../autodraft";
import { autopickDue } from "../draft-autopick";
import { DEFAULT_PICK_CLOCK } from "../draft-clock";
import { POOL, find } from "../../data/league-data";

let failed = 0;
const ok = (label: string, got: boolean) => {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  if (!got) failed++;
};
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}`}`);
  if (!pass) failed++;
};

const LEAGUE = {
  starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, K: 1, "D/ST": 1 },
  bench: 6,
  rounds: 15,
};

const positionOf = (name: string | null) => (name ? (find(name)?.p ?? "") : "");

console.log("--- the first pick of a draft ---");

const first = autodraftPick({ taken: new Set(), roster: [], round: 1, rounds: 15, league: LEAGUE });
ok("somebody is picked", Boolean(first));
ok(
  "and he is near the top of the board",
  (find(first!)?.adp ?? 999) <= 12,
);
ok(
  "not a kicker or a defence in the first round",
  !["K", "D/ST"].includes(positionOf(first)),
);

console.log("\n--- the same board twice ---");

const again = autodraftPick({ taken: new Set(), roster: [], round: 1, rounds: 15, league: LEAGUE });
eq("makes the same pick, every time", again, first);

console.log("\n--- a roster that already has enough of something ---");

// Four quarterbacks deep and nothing else. Best-available-by-ADP would take a
// fifth if one happened to sit at the top of the board; need says no.
const quarterbacks = POOL.filter((p) => p.p === "QB")
  .sort((a, b) => a.adp - b.adp)
  .slice(0, 4)
  .map((p) => p.n);

const afterQbs = autodraftPick({
  taken: new Set(quarterbacks),
  roster: quarterbacks,
  round: 5,
  rounds: 15,
  league: LEAGUE,
});
ok(`does not take a fifth quarterback (${afterQbs} — ${positionOf(afterQbs)})`,
   positionOf(afterQbs) !== "QB");

console.log("\n--- the end of the draft ---");

// A roster with everything but a kicker, in the last round. ADP puts kickers
// around two hundred and forty, so a board read straight down never reaches
// one — the whole reason this is not "best available".
const filled = [
  ...POOL.filter((p) => p.p === "QB").slice(0, 1),
  ...POOL.filter((p) => p.p === "RB").slice(0, 4),
  ...POOL.filter((p) => p.p === "WR").slice(0, 5),
  ...POOL.filter((p) => p.p === "TE").slice(0, 2),
  ...POOL.filter((p) => p.p === "D/ST").slice(0, 1),
].map((p) => p.n);

const lastPick = autodraftPick({
  taken: new Set(filled),
  roster: filled,
  round: 15,
  rounds: 15,
  league: LEAGUE,
});
ok(`takes the kicker it still needs (${lastPick} — ${positionOf(lastPick)})`,
   positionOf(lastPick) === "K");

console.log("\n--- a board with nobody left on it ---");

eq(
  "is a real answer, not an invented player",
  autodraftPick({
    taken: new Set(POOL.map((p) => p.n)),
    roster: [],
    round: 9,
    rounds: 15,
    league: LEAGUE,
  }),
  null,
);

console.log("\n--- whether a pick is due ---");

const CLOCK = DEFAULT_PICK_CLOCK;
const now = Date.parse("2026-09-01T20:00:00Z");
const ago = (seconds: number) => new Date(now - seconds * 1000).toISOString();
const clocked = (round: number, seconds: number, autodraft = false) => ({
  state: "running",
  pickStartedAt: ago(seconds),
  onTheClock: { manager_id: "m1", round, overall: round },
  autodraft,
});

ok("not while the clock is running", !autopickDue(CLOCK, clocked(1, 30), now));
ok("not at eighty-nine seconds in round one", !autopickDue(CLOCK, clocked(1, 89), now));
ok("but at ninety it is", autopickDue(CLOCK, clocked(1, 90), now));

// The round is what decides it, which is the whole point of the ladder: the
// same eighty seconds is early in round one and late in round eleven.
ok("eighty seconds is still early in round one", !autopickDue(CLOCK, clocked(1, 80), now));
ok("and late in round eleven", autopickDue(CLOCK, clocked(11, 80), now));
ok("seventy is early in round five", !autopickDue(CLOCK, clocked(5, 70), now));
ok("and late in round eleven", autopickDue(CLOCK, clocked(11, 70), now));

console.log("\n--- somebody who said they would not be here ---");

ok("does not wait for a clock", autopickDue(CLOCK, clocked(1, 0, true), now));
ok(
  "nor for one that has not started",
  autopickDue(
    CLOCK,
    { state: "running", pickStartedAt: null, onTheClock: { manager_id: "m1", round: 1, overall: 1 }, autodraft: true },
    now,
  ),
);

console.log("\n--- nothing to pick for ---");

ok(
  "not while the draft is paused",
  !autopickDue(CLOCK, { ...clocked(1, 500), state: "paused" }, now),
);
ok(
  "nor when it is complete",
  !autopickDue(CLOCK, { ...clocked(1, 500), state: "complete" }, now),
);
ok(
  "nor with nobody on the clock",
  !autopickDue(CLOCK, { ...clocked(1, 500), onTheClock: null }, now),
);
ok(
  "nor before the first clock has started",
  !autopickDue(
    CLOCK,
    { state: "running", pickStartedAt: null, onTheClock: { manager_id: "m1", round: 1, overall: 1 }, autodraft: false },
    now,
  ),
);
ok(
  "nor on a timestamp that is not one",
  !autopickDue(
    CLOCK,
    { state: "running", pickStartedAt: "soon", onTheClock: { manager_id: "m1", round: 1, overall: 1 }, autodraft: false },
    now,
  ),
);

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
