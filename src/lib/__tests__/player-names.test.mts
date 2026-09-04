import { NameIndex, defenseTeamName, isDefense, normalizeName } from "../player-names";
import { POOL } from "../../data/league-data";

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

console.log("--- the same player, spelled differently ---");

// Every one of these is a spelling ESPN has used for a player the pool carries
// under the other. A miss on any of them is a manager staring at a zero.
const SAME: [string, string][] = [
  ["Marvin Harrison Jr.", "Marvin Harrison Jr"],
  ["Travis Etienne Jr.", "Travis Etienne"],
  ["A.J. Brown", "AJ Brown"],
  ["Ja'Marr Chase", "JaMarr Chase"],
  ["Ja'Marr Chase", "Ja’Marr Chase"], // a curly apostrophe
  ["Jaxon Smith-Njigba", "Jaxon Smith Njigba"],
  ["Amon-Ra St. Brown", "Amon-Ra St Brown"],
  ["Kenneth Walker III", "Kenneth Walker"],
  ["T.J. Hockenson", "TJ Hockenson"],
  ["DeVon Achane", "De'Von Achane"],
  ["  Bijan   Robinson ", "Bijan Robinson"],
];

for (const [a, b] of SAME) {
  ok(`"${a}" is "${b}"`, normalizeName(a) === normalizeName(b));
}

console.log("\n--- and different players, who must stay different ---");

const DIFFERENT: [string, string][] = [
  ["Josh Allen", "Keenan Allen"],
  ["Michael Thomas", "Michael Pittman Jr."],
  ["Justin Jefferson", "Van Jefferson"],
];

for (const [a, b] of DIFFERENT) {
  ok(`"${a}" is not "${b}"`, normalizeName(a) !== normalizeName(b));
}

// A suffix is stripped only when there is a name left underneath it.
eq("a lone suffix keeps itself", normalizeName("III"), "iii");
eq("trailing suffixes all come off", normalizeName("Frank Gore Jr. Sr."), "frank gore");
eq("a surname that reads like a suffix survives", normalizeName("Vonn Bell"), "vonn bell");
eq("nothing at all normalises to nothing", normalizeName("   "), "");

console.log("\n--- the whole pool ---");

const names = POOL.map((p) => p.n);
const index = new NameIndex(names);

// The one failure mode that would be worse than a missing score: two players
// collapsing onto one key, so one of them collects the other's points.
eq("no two players in the pool share a key", index.collisions, []);

const lost = names.filter((n) => !isDefense(n) && index.lookup(n) !== n);
eq("every player can find himself", lost, []);

eq(
  "the units are held out, to be matched by team instead",
  index.size,
  names.filter((n) => !isDefense(n)).length,
);

// Spot-checks through the index rather than the raw function, since that is
// how the scorer actually asks.
eq("ESPN's suffix resolves to the pool's", index.lookup("Marvin Harrison Jr"), "Marvin Harrison Jr.");
eq("initials without stops resolve", index.lookup("AJ Brown"), "A.J. Brown");
eq("a stranger resolves to nothing", index.lookup("Some Guy Nobody Rostered"), null);

console.log("\n--- units ---");

ok("a defence is recognised", isDefense("Baltimore Ravens D/ST"));
ok("a person is not", !isDefense("Lamar Jackson"));
eq("the team comes off cleanly", defenseTeamName("Baltimore Ravens D/ST"), "Baltimore Ravens");

console.log("\n--- a roster the pool never had ---");

// A waiver pickup from outside the draftable five hundred still has to score,
// so the index is built from whatever it is given.
const waiver = new NameIndex(["Nobody From The Pool", "Tanner Hudson"]);
eq("an off-pool name indexes", waiver.lookup("Tanner Hudson"), "Tanner Hudson");
eq("and normalises like any other", waiver.lookup("tanner hudson"), "Tanner Hudson");

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
