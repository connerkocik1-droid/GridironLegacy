import { defaultLineup, lineupProblems, slotAccepts, startingSlots, validateLineup } from "../lineup";

let failed = 0;
const ok = (label: string, got: boolean, want = true) => {
  const pass = got === want;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) failed++;
};
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}`}`);
  if (!pass) failed++;
};

const LEAGUE = {
  starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, "D/ST": 1, K: 1 },
  bench: 14,
  ir: 2,
};

// Real players, so positions resolve through the actual pool.
const QB = "Jayden Daniels";
const RB1 = "Jahmyr Gibbs";
const RB2 = "Bijan Robinson";
const RB3 = "James Cook III";
const WR1 = "Ja'Marr Chase";
const WR2 = "Puka Nacua";
const TE = "Brock Bowers";
const K = "Brandon Aubrey";
const DST = "Seattle Seahawks D/ST";

console.log("--- slot eligibility ---");
ok("QB slot takes a QB", slotAccepts("QB", "QB", LEAGUE));
ok("QB slot rejects an RB", slotAccepts("QB", "RB", LEAGUE), false);
ok("FLEX takes an RB", slotAccepts("FLEX", "RB", LEAGUE));
ok("FLEX takes a WR", slotAccepts("FLEX", "WR", LEAGUE));
ok("FLEX takes a TE", slotAccepts("FLEX", "TE", LEAGUE));
ok("FLEX rejects a QB", slotAccepts("FLEX", "QB", LEAGUE), false);
ok("FLEX rejects a kicker", slotAccepts("FLEX", "K", LEAGUE), false);
ok("BENCH takes anyone", slotAccepts("BENCH", "K", LEAGUE));
ok("IR takes anyone", slotAccepts("IR", "D/ST", LEAGUE));

// A league that does not start tight ends must not offer them a flex spot.
const NO_TE = { ...LEAGUE, starters: { ...LEAGUE.starters, TE: 0 } };
ok("FLEX rejects a TE where the league starts none", slotAccepts("FLEX", "TE", NO_TE), false);

console.log("\n--- starting slots ---");
eq("slots come out in league order", startingSlots(LEAGUE), [
  "QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "D/ST", "K",
]);

console.log("\n--- whole-lineup validation ---");
const roster = [QB, RB1, RB2, RB3, WR1, WR2, TE, K, DST];
const legal = [
  { playerName: QB, slot: "QB" },
  { playerName: RB1, slot: "RB" },
  { playerName: RB2, slot: "RB" },
  { playerName: WR1, slot: "WR" },
  { playerName: WR2, slot: "WR" },
  { playerName: TE, slot: "TE" },
  { playerName: RB3, slot: "FLEX" },
  { playerName: DST, slot: "D/ST" },
  { playerName: K, slot: "K" },
];

ok("a legal lineup passes", validateLineup(legal, roster, LEAGUE).ok);

const tooManyRB = legal.map((a) => (a.playerName === WR1 ? { ...a, slot: "RB" } : a));
ok("a third RB in an RB slot is refused", validateLineup(tooManyRB, roster, LEAGUE).ok, false);
eq(
  "and says why",
  validateLineup(tooManyRB, roster, LEAGUE).error,
  "Only 2 RB can start",
);

const qbInFlex = legal.map((a) => (a.playerName === RB3 ? { playerName: QB, slot: "FLEX" } : a));
ok("a QB in the flex is refused", validateLineup(qbInFlex, roster, LEAGUE).ok, false);

const notOwned = [...legal, { playerName: "Somebody Else", slot: "BENCH" }];
ok("a player you do not own is refused", validateLineup(notOwned, roster, LEAGUE).ok, false);

const twice = legal.map((a, i) => (i === 0 ? { playerName: RB1, slot: "QB" } : a));
ok("the same player twice is refused", validateLineup(twice, roster, LEAGUE).ok, false);

const missing = legal.slice(0, -1);
ok("leaving a player unassigned is refused", validateLineup(missing, roster, LEAGUE).ok, false);

const unknownSlot = legal.map((a) => (a.playerName === K ? { ...a, slot: "P" } : a));
ok("a slot the league does not field is refused", validateLineup(unknownSlot, roster, LEAGUE).ok, false);

// Benching everyone is legal — a manager may field an incomplete lineup.
const allBench = roster.map((n) => ({ playerName: n, slot: "BENCH" }));
ok("an all-bench lineup is allowed", validateLineup(allBench, roster, LEAGUE).ok);

const overBench = { ...LEAGUE, bench: 3 };
ok("more on the bench than the league allows is refused",
  validateLineup(allBench, roster, overBench).ok, false);

const overIr = roster.map((n) => ({ playerName: n, slot: "IR" }));
ok("more on IR than the league allows is refused",
  validateLineup(overIr, roster, LEAGUE).ok, false);

console.log("\n--- default lineup ---");
const rank = (n: string) => roster.length - roster.indexOf(n);
const seeded = defaultLineup(roster, LEAGUE, rank);
ok("every player gets a slot", seeded.length === roster.length);
ok("the seeded lineup is legal", validateLineup(seeded, roster, LEAGUE).ok);

const thin = [QB, K];
const thinLineup = defaultLineup(thin, LEAGUE, rank);
ok("a short roster still produces a legal lineup",
  validateLineup(thinLineup, thin, LEAGUE).ok);
eq("and leaves the empty slots unfilled rather than inventing players",
  thinLineup.length, 2);


console.log("\n--- what is wrong with a legal lineup ---");

// A stand-in pool, so these checks are about the rule rather than about who
// happens to be on a bye in the real data.
const POOL: Record<string, { p: string; bye: number; q: boolean }> = {
  "Bye Guy": { p: "RB", bye: 7, q: false },
  "Sore Guy": { p: "WR", bye: 9, q: true },
  "Fine Guy": { p: "QB", bye: 9, q: false },
  "Depth Guy": { p: "RB", bye: 9, q: false },
};
const look = (n: string) => POOL[n] ?? null;

const full = [
  { playerName: "Fine Guy", slot: "QB" },
  { playerName: "Bye Guy", slot: "RB" },
  { playerName: "Sore Guy", slot: "WR" },
];
const SMALL = { starters: { QB: 1, RB: 1, WR: 1 }, bench: 4 };

const found = lineupProblems(full, SMALL, 7, look);
eq("a starter on his bye is reported", found.filter((x) => x.kind === "bye").map((x) => x.player),
  ["Bye Guy"]);
eq("a questionable starter is reported too",
  found.filter((x) => x.kind === "injured").map((x) => x.player), ["Sore Guy"]);
ok("and the bye is listed first, because it is certain",
  found[0].kind === "bye");

eq("in a week that is not his bye he is not flagged for it",
  lineupProblems(full, SMALL, 3, look).filter((x) => x.kind === "bye").length, 0);

const short = [{ playerName: "Fine Guy", slot: "QB" }];
const gaps = lineupProblems(short, SMALL, 3, look);
eq("every unfilled starting seat is named", gaps.map((x) => x.slot).sort(), ["RB", "WR"]);
ok("and an empty slot outranks everything else", gaps[0].kind === "empty");

// Two of three flex seats filled is one empty flex, not none and not three.
const FLEXY = { starters: { FLEX: 3 }, bench: 4 };
const twoFlex = [
  { playerName: "Bye Guy", slot: "FLEX" },
  { playerName: "Sore Guy", slot: "FLEX" },
];
eq("a partly filled multi-seat slot reports only the seats left",
  lineupProblems(twoFlex, FLEXY, 3, look).filter((x) => x.kind === "empty").length, 1);

// The same roster in the same week, with the bye player sat down instead.
const benched = [
  { playerName: "Fine Guy", slot: "QB" },
  { playerName: "Depth Guy", slot: "RB" },
  { playerName: "Sore Guy", slot: "WR" },
  { playerName: "Bye Guy", slot: "BENCH" },
];
eq("a benched player on his bye is nobody's problem",
  lineupProblems(benched, SMALL, 7, look).filter((x) => x.kind === "bye").length, 0);
eq("and sitting him leaves no hole behind",
  lineupProblems(benched, SMALL, 7, look).filter((x) => x.kind === "empty").length, 0);

eq("and a player nobody knows about is not invented into a problem",
  lineupProblems([{ playerName: "Nobody At All", slot: "QB" }], SMALL, 7, look)
    .filter((x) => x.kind !== "empty").length, 0);

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
