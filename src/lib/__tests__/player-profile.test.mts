/**
 * What a profile is allowed to say.
 *
 * The page is read while a decision is being made this week, so it holds two
 * seasons and no more: this one, from the league's own scores, and 2025, from
 * the historical pool. The pool reaches back to 2002 — a 2014 line on the page
 * is not extra context, it is a wrong answer to "how is he doing".
 */

import { profileFor, resolvePlayerName } from "../player-profile";

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

console.log("--- 2025, and nothing older ---");

// Checked across the whole pool rather than on one man, because the rule is
// about the filter and a single player proves only that his own row passed.
const names = [
  "Ja'Marr Chase", "Bijan Robinson", "Josh Allen", "Puka Nacua",
  "Brock Bowers", "Saquon Barkley", "Lamar Jackson", "Amon-Ra St. Brown",
];

let seasons = 0;
for (const name of names) {
  const profile = profileFor(name);
  seasons += profile.career.length;
  ok(`${name}: no season is from any year but 2025`,
    profile.career.every((s) => s.year === 2025));
  ok(`  and at most one row`, profile.career.length <= 1);
}
ok(`the pool actually had seasons to filter (${seasons})`, seasons > 0);

console.log("\n--- who he is ---");

const chase = profileFor("Ja'Marr Chase");
ok("the position comes through", chase.position === "WR");
ok("and the team", chase.team.length > 0);
ok("with the market's opinion", chase.adp != null);
ok("and the pool's", Boolean(chase.archetype) || Boolean(chase.insight));
ok("he is found", chase.found);

console.log("\n--- somebody the pool never heard of ---");

const stranger = profileFor("Nobody At All");
ok("still gets a profile", stranger.name === "Nobody At All");
ok("which does not pretend to know him", !stranger.found);
eq("and invents no seasons", stranger.career, []);
eq("nor a draft position", stranger.adp, null);

console.log("\n--- the league's own spelling ---");

eq("a name typed loosely resolves", resolvePlayerName("jamarr chase"), "Ja'Marr Chase");
eq("suffixes and all", resolvePlayerName("Marvin Harrison Jr"), "Marvin Harrison Jr.");
eq("and an unknown name is left as typed", resolvePlayerName("Nobody At All"), "Nobody At All");

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
