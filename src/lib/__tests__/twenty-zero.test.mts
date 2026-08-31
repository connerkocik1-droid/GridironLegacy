import { ERA_LABELS, POOLS, type Season } from "../../data/twenty-zero-data";
import {
  BOARD_SIZE,
  DEFENSE,
  MULT,
  OFFENSE,
  SLOTS,
  candidatesFor,
  drawSpin,
  playable,
  poolFor,
  poolsForSlot,
  rngFrom,
  sideFor,
  slotIndexFor,
  total,
  type Roster,
} from "../twenty-zero";

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

const empty = (): Roster => Array(SLOTS.length).fill(null);
const man = (pos: string, sc: number, n = `${pos}-${sc}`, t = "BUF", era = 1): Season =>
  ({ n, t, yr: 2015, era, pos, sc, line: "", line2: "" });

console.log("");
console.log("--- the shape of a run ---");

eq("twelve slots", SLOTS.length, 12);
eq("six offence, six defence", [OFFENSE.length, DEFENSE.length], [6, 6]);
eq("rounds one to six are offence", sideFor(0), OFFENSE);
eq("seven to twelve are defence", sideFor(6), DEFENSE);
eq("three eras", ERA_LABELS.length, 3);

console.log("");
console.log("--- where a player lands ---");

{
  const roster = empty();
  eq("a quarterback takes the quarterback slot", slotIndexFor("QB", 0, roster), 0);
  eq("a runner takes the running back slot", slotIndexFor("RB", 0, roster), 1);
  eq("an edge takes the edge slot", slotIndexFor("DL", 6, roster), 6);
  eq("a linebacker takes the linebacker slot", slotIndexFor("LB", 6, roster), 8);
}

{
  // Named slots first, then the flex — never the other way round.
  const roster = empty();
  roster[1] = man("RB", 50);
  eq("a second runner goes to the flex", slotIndexFor("RB", 0, roster), 4);
  roster[4] = man("RB", 40);
  eq("a third takes the other flex", slotIndexFor("RB", 0, roster), 5);
  roster[5] = man("RB", 30);
  eq("and a fourth has nowhere to go", slotIndexFor("RB", 0, roster), -1);
}

{
  const roster = empty();
  roster[0] = man("QB", 90);
  eq("a second quarterback is not a flex", slotIndexFor("QB", 0, roster), -1);
  ok("because the offensive flex does not take one", !poolsForSlot("FLEX", false).includes("QB"));
}

{
  // The grouped pools: one export feeds two slots on each side.
  const roster = empty();
  roster[6] = man("DL", 80);
  eq("a second lineman takes the interior slot", slotIndexFor("DL", 6, roster), 7);
  roster[7] = man("DL", 70);
  eq("and a third the defensive flex", slotIndexFor("DL", 6, roster), 11);

  const backs = empty();
  backs[9] = man("DB", 80);
  eq("a second back takes the corner-safety slot", slotIndexFor("DB", 6, backs), 10);
}

{
  ok("a defender cannot land on the offensive side", slotIndexFor("DL", 0, empty()) === -1);
  ok("nor a receiver on the defensive side", slotIndexFor("WR", 6, empty()) === -1);
}

console.log("");
console.log("--- when a round has nothing to offer ---");

{
  const roster = empty();
  ok("a fresh defensive round is playable", playable(6, roster, POOLS));

  // Fill every slot a lineman could reach, and the linemen are stranded even
  // though the pool is enormous.
  roster[6] = man("DL", 80);
  roster[7] = man("DL", 70);
  roster[11] = man("DL", 60);
  eq("a lineman then has nowhere left", slotIndexFor("DL", 6, roster), -1);
  ok("but the round is still playable while backers and backs are open",
    playable(6, roster, POOLS));

  roster[8] = man("LB", 80);
  roster[9] = man("DB", 80);
  roster[10] = man("DB", 70);
  ok("with the whole side full, it is not", playable(6, roster, POOLS), false);
}

console.log("");
console.log("--- the board a spin offers ---");

{
  const rng = rngFrom(1);
  const cands = candidatesFor(POOLS, "BUF", 2, 0, empty(), rng);
  eq("six rows", cands.length, BOARD_SIZE);
  ok("the franchise's own come first",
    cands.findIndex((c) => !c.own) === -1 || cands.every((c, i, a) => i === 0 || a[i - 1].own || !c.own));
  ok("its own are all that franchise", cands.filter((c) => c.own).every((c) => c.season.t === "BUF"));
  ok("and all that era", cands.every((c) => c.season.era === 2));
  ok("best season first among its own",
    cands.filter((c) => c.own).every((c, i, a) => i === 0 || a[i - 1].season.sc >= c.season.sc));
}

{
  // Nobody appears twice in a run, even across different seasons of theirs.
  const rng = rngFrom(4);
  const first = candidatesFor(POOLS, "KC", 2, 0, empty(), rng);
  const roster = empty();
  roster[0] = first.find((c) => c.season.pos === "QB")?.season ?? first[0].season;
  const again = candidatesFor(POOLS, "KC", 2, 0, roster, rngFrom(4));
  ok("a player already taken is off the board",
    !again.some((c) => c.season.n === roster[0]!.n));
}

{
  // Every row must be placeable — a board you cannot pick from is not a board.
  const roster = empty();
  roster[6] = man("DL", 80);
  roster[7] = man("DL", 70);
  roster[11] = man("DL", 60);
  const cands = candidatesFor(POOLS, "PIT", 2, 6, roster, rngFrom(9));
  ok("with the line full, no lineman is offered",
    cands.every((c) => c.season.pos !== "DL"));
  ok("and every row still has somewhere to go",
    cands.every((c) => slotIndexFor(c.season.pos, 6, roster) > -1));
}

console.log("");
console.log("--- scoring ---");

{
  const roster = empty();
  roster[0] = man("QB", 100);
  eq("the quarterback counts one and a half", total(roster), 150);

  roster[1] = man("RB", 100);
  eq("a running back counts once", total(roster), 250);

  const defence = empty();
  defence[6] = man("DL", 100);
  eq("so does the edge", total(defence), 150);
  defence[9] = man("DB", 100);
  eq("and the corner", total(defence), 300);
  defence[7] = man("DL", 100);
  eq("but the interior line does not", total(defence), 400);
}

eq("three slots carry a multiplier", Object.keys(MULT).sort(), ["CB", "EDGE", "QB"]);
eq("an empty roster scores nothing", total(empty()), 0);

console.log("");
console.log("--- a whole run, on the real pool ---");

{
  const rng = rngFrom(20260831);
  const roster = empty();
  let skipped = 0;

  for (let round = 0; round < SLOTS.length; round++) {
    if (!playable(round, roster, POOLS)) {
      skipped++;
      continue;
    }
    const spin = drawSpin(POOLS, round, roster, rng);
    if (!spin) {
      skipped++;
      continue;
    }
    // Take the top row, as a player racing through would.
    const pick = spin.candidates[0];
    const idx = slotIndexFor(pick.season.pos, round, roster);
    ok(`round ${round + 1} offers a pick that fits`, idx > -1);
    roster[idx] = pick.season;
  }

  eq("no round was unplayable", skipped, 0);
  eq("every slot is filled", roster.filter(Boolean).length, 12);
  eq("nobody is on it twice", new Set(roster.map((p) => p!.n)).size, 12);

  const offence = roster.slice(0, 6);
  const defence = roster.slice(6);
  ok("the offence is all offensive positions",
    offence.every((p) => ["QB", "RB", "WR", "TE"].includes(p!.pos)));
  ok("the defence is all defensive positions",
    defence.every((p) => ["DL", "LB", "DB"].includes(p!.pos)));
  eq("exactly one quarterback", offence.filter((p) => p!.pos === "QB").length, 1);

  const score = total(roster);
  ok(`a greedy run scores well (${Math.round(score)})`, score > 900 && score <= 1350);
}

{
  // The spin must not offer a franchise-era with nothing on it.
  const rng = rngFrom(7);
  let empties = 0;
  for (let i = 0; i < 200; i++) {
    const spin = drawSpin(POOLS, i % 12 < 6 ? 0 : 6, empty(), rng);
    if (!spin || !spin.candidates.length) empties++;
  }
  eq("two hundred spins, none of them empty", empties, 0);
}

{
  // Every round's pool is drawn from that side and nothing else.
  for (let round = 0; round < SLOTS.length; round++) {
    const want = round < 6 ? ["QB", "RB", "WR", "TE"] : ["DL", "LB", "DB"];
    const got = [...new Set(poolFor(round, POOLS).map((p) => p.pos))].sort();
    eq(`round ${round + 1} draws only its own side`, got, want.sort());
  }
}

console.log("");
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
