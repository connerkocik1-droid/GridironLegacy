import { availablePlayers } from "../draft-pool";
import { POOL } from "../../data/league-data";

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

console.log("--- who the draft room can see ---");

const all = availablePlayers(new Set());

eq("nobody drafted means the whole pool is available", all.length, POOL.length);

// The bug this file exists for: the route used to send the first two hundred
// by ADP, and kickers and defences have the latest ADP there is. A league
// cannot draft a player the server never sent.
const count = (position: string) => all.filter((p) => p.position === position).length;

// Twelve franchises starting one apiece, plus anyone taken as cover. Twelve is
// the floor below which somebody ends draft night unable to field a legal team.
for (const position of ["QB", "RB", "WR", "TE", "K", "D/ST"]) {
  ok(
    `every franchise can draft a ${position} (${count(position)} available)`,
    count(position) >= 12,
  );
}

ok("kickers in particular, which is how this was found", count("K") >= 12);
ok("and defences, which had none at all", count("D/ST") >= 12);

// A twelve-team, twenty-four-round draft is 288 picks. A pool smaller than
// that runs dry before the last round.
ok(`the pool outlasts a full draft (${all.length} for 288 picks)`, all.length >= 288);

console.log("\n--- and who it cannot ---");

const taken = new Set([POOL[0].n, POOL[5].n, POOL[9].n]);
const left = availablePlayers(taken);

eq("a drafted player is gone", left.length, POOL.length - 3);
ok("by name", left.every((p) => !taken.has(p.name)));

eq("the order is the pool's own, so the best available is still first",
  left[0].name, POOL.find((p) => !taken.has(p.n))!.n);

const shape = left[0];
eq("each one carries what the draft room draws",
  Object.keys(shape).sort(),
  ["adp", "bye", "name", "posRank", "position", "team"]);

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
