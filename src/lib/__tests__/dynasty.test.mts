import { readFileSync } from "node:fs";
import { AGES, POOL } from "../../data/league-data.js";
import { byDynastyAdp, dynastyAdp, dynastyBoard, modifierFor, valueOf } from "../dynasty";

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

interface Row {
  position: string;
  age: number;
  openEnded: boolean;
  modifier: number;
}

// Read straight from the spreadsheet the league supplied, so this checks the
// module against the source rather than against a second copy of my typing.
const SHEET: Row[] = JSON.parse(
  readFileSync(new URL("../../data/dynasty-modifiers.json", import.meta.url), "utf8"),
);

console.log("\n--- every row of the spreadsheet ---");
{
  const wrong = SHEET.filter((r) => modifierFor(r.position, r.age) !== r.modifier);
  eq(`all ${SHEET.length} rows match`, wrong.map((r) => `${r.position} ${r.age}`), []);
}

console.log("\n--- the open-ended rows keep going ---");
for (const row of SHEET.filter((r) => r.openEnded)) {
  const label = `${row.position} ${row.age}+ stays ${row.modifier}`;
  ok(label, [row.age, row.age + 5, row.age + 12, 60].every(
    (age) => modifierFor(row.position, age) === row.modifier));
}

console.log("\n--- the age the sheet does not mention ---");
// Quarterbacks list 31 then 33. Thirty-two sits in the band 31 opened.
eq("a 31-year-old quarterback", modifierFor("QB", 31), 1);
eq("a 32-year-old quarterback keeps that band", modifierFor("QB", 32), 1);
eq("and 33 picks up the next row", modifierFor("QB", 33), 0.95);

console.log("\n--- younger than the table goes ---");
for (const position of ["QB", "RB", "WR", "TE", "K"]) {
  const youngest = SHEET.filter((r) => r.position === position)
    .sort((a, b) => a.age - b.age)[0];
  ok(`a ${position} younger than ${youngest.age} is treated as ${youngest.age}`,
    modifierFor(position, 19) === youngest.modifier
      && modifierFor(position, 17) === youngest.modifier);
}

console.log("\n--- positions and ages the table has nothing to say about ---");
eq("a defence is never adjusted", modifierFor("D/ST", 30), 1);
eq("nor is a player whose age is unknown", modifierFor("RB", null), 1);
eq("nor one with a nonsense age", modifierFor("RB", Number.NaN), 1);

console.log("\n--- what a modifier does to a draft position ---");
eq("a young back moves up the board", dynastyAdp("RB", 24, 21), 20);
eq("an old back falls down it", dynastyAdp("RB", 24, 32), 30);
eq("a player at his peak does not move", dynastyAdp("RB", 24, 28), 24);
eq("an unknown age leaves the consensus alone", dynastyAdp("RB", 24, null), 24);
eq("a defence keeps its ADP", dynastyAdp("D/ST", 240, null), 240);
ok("nobody is moved to a negative pick",
  [1, 24, 100, 240].every((adp) =>
    ["QB", "RB", "WR", "TE", "K"].every((p) =>
      [21, 28, 40].every((age) => dynastyAdp(p, adp, age) > 0))));

console.log("\n--- the same points are worth more when they last longer ---");
{
  // Two players the consensus rates identically. Dynasty does not.
  const young = dynastyAdp("WR", 30, 22);
  const old = dynastyAdp("WR", 30, 33);
  ok(`the 22-year-old goes first (${young} vs ${old})`, young < old);
  ok("and the gap is meaningful, not a rounding error", old - young > 5);
}

console.log("\n--- against the real pool ---");
{
  const board = dynastyBoard();
  eq("every player is on it", board.length, POOL.length);
  ok("it is ordered by the dynasty number",
    board.every((p, i) => i === 0 || board[i - 1].dynastyAdp <= p.dynastyAdp));
  ok("everyone the pool knows an age for carries it",
    board.filter((p) => AGES[p.name]).every((p) => p.age === AGES[p.name].age));
  ok("and everyone it does not is left unmoved",
    board.filter((p) => !AGES[p.name]).every((p) => p.dynastyAdp === p.adp && p.modifier === 1));

  const moved = board.filter((p) => p.dynastyAdp !== p.adp);
  ok(`the table actually moves people (${moved.length} of ${board.length})`, moved.length > 200);

  const up = board.filter((p) => p.modifier > 1);
  const down = board.filter((p) => p.modifier < 1);
  ok(`some rise (${up.length}) and some fall (${down.length})`, up.length > 0 && down.length > 0);
  ok("a rise is always an earlier pick", up.every((p) => p.dynastyAdp < p.adp));
  ok("and a fall always a later one", down.every((p) => p.dynastyAdp > p.adp));
}

console.log("\n--- sorting is stable and total ---");
{
  const a = { name: "A", position: "RB", age: 25, adp: 10, modifier: 1, dynastyAdp: 10 };
  const b = { name: "B", position: "WR", age: 25, adp: 10, modifier: 1, dynastyAdp: 10 };
  ok("identical players are still ordered", byDynastyAdp(a, b) < 0);
  eq("and a player against himself is a draw", byDynastyAdp(a, { ...a }), 0);
}

console.log("\n--- one real player, end to end ---");
{
  const first = POOL.find((p) => p.p === "RB" && AGES[p.n]);
  if (!first) {
    ok("the pool has a back with a known age", false);
  } else {
    const v = valueOf(first);
    const want = modifierFor("RB", AGES[first.n].age);
    eq(`${first.n} (${AGES[first.n].age}) takes the table's modifier`, v.modifier, want);
    eq("and his dynasty ADP is his ADP divided by it",
      v.dynastyAdp, Math.round((first.adp / want) * 10) / 10);
  }
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
