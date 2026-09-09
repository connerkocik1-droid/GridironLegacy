import { POOL } from "../../data/league-data";
import { NameIndex } from "../player-names";
import { key } from "../../../scripts/roster-sync.mjs";
import rosters from "../../data/nfl-rosters-2026.json" with { type: "json" };

/**
 * Every man on an NFL roster is in the pool.
 *
 * The pool was hand-maintained and it drifted: at the start of the 2026 season
 * it was missing two hundred and eleven players who were on a roster that
 * week, among them Tua Tagovailoa, Michael Penix Jr., Geno Smith, Deshaun
 * Watson, Travis Hunter, Rashod Bateman, Cade Otton, Michael Mayer and Tyler
 * Bass. A missing player is not a missing row — he cannot be drafted, claimed,
 * traded or looked up, and if he scores on a Sunday the manager who somehow
 * has him is looking at a zero.
 *
 * The snapshot this checks against is written by scripts/roster-sync.mjs from
 * nflverse's copy of the league's own roster feed. It is checked in so the
 * guarantee holds with no network: the test cannot tell you the rosters have
 * changed since, only that the pool covers the rosters we last looked at.
 * Re-run the script in August to refresh both.
 */

let failed = 0;
const ok = (label: string, got: boolean) => {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  if (!got) failed++;
};

const players = rosters.players as { n: string; p: string; t: string }[];

console.log("--- the pool covers the NFL ---");
console.log(`(${players.length} men on a 2026 roster at QB, RB, WR, TE or K)`);

const have = new Set(POOL.map((p) => key(p.n)));
const missing = players.filter((r) => !have.has(key(r.n)));

for (const r of missing.slice(0, 40)) console.log(`   MISSING  ${r.n} (${r.p} ${r.t})`);
ok(`nobody on an NFL roster is missing from the pool${missing.length ? ` — ${missing.length} are` : ""}`,
  missing.length === 0);

// Position by position, because a gap is never spread evenly: the pool was
// short sixty-one tight ends and four kickers, and a league that cannot draft
// a kicker cannot field a legal lineup.
for (const position of ["QB", "RB", "WR", "TE", "K"]) {
  const gap = missing.filter((r) => r.p === position);
  ok(`every ${position} in the NFL is in the pool (${gap.length} missing)`, gap.length === 0);
}

// Thirty-two starting kickers and thirty-two starting quarterbacks exist. If
// the pool holds fewer at a position than there are teams, something has gone
// wrong upstream rather than in the data.
for (const position of ["QB", "K"]) {
  const n = POOL.filter((p) => p.p === position).length;
  ok(`the pool holds at least one ${position} per NFL team (${n})`, n >= 32);
}

console.log("\n--- and every one of them can actually be found ---");

// Coverage is not the same as reachability. Live scoring looks players up by
// the name the feed uses, and a player the index cannot resolve scores nothing.
const index = new NameIndex(POOL.map((p) => p.n));
const unreachable = players.filter((r) => !index.has(r.n));
for (const r of unreachable.slice(0, 20)) console.log(`   UNREACHABLE  ${r.n} (${r.p} ${r.t})`);
ok(`every rostered player resolves through the name index${unreachable.length ? ` — ${unreachable.length} do not` : ""}`,
  unreachable.length === 0);

console.log("\n--- and the pool stays coherent ---");

const names = POOL.map((p) => p.n);
ok("no player appears twice", new Set(names).size === names.length);

const ranks = POOL.map((p) => p.posRank).filter(Boolean);
ok("no two players share a position rank", new Set(ranks).size === ranks.length);

let ordered = true;
for (let i = 1; i < POOL.length; i++) if (POOL[i].adp < POOL[i - 1].adp) ordered = false;
ok("the board is in draft order", ordered);

const teamed = POOL.filter((p) => p.p !== "D/ST" && p.t !== "FA");
ok("everybody on a team has that team's bye week", teamed.every((p) => p.bye != null));

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
