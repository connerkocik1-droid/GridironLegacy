/**
 * The stat line beside a score.
 *
 * Two rules run through all of it. What a position is *for* always shows, even
 * at nought — a back handed the ball twice for no gain should say so, because
 * a blank reads as missing data rather than as a bad afternoon. Everything
 * else, touchdowns included, shows only when it happened: "0 rush TD" beside
 * every quarterback in the league is noise that hides the one who ran for two.
 */

import { formatStatLine, readStatLine, scoreDefense, type StatLine } from "../scoring";
import type { PlayerStat } from "../espn";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : `\n      got  ${JSON.stringify(got)}\n      want ${JSON.stringify(want)}`}`);
  if (!pass) failed++;
};
const ok = (label: string, got: boolean) => {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  if (!got) failed++;
};

const stat = (group: string, stats: Record<string, string>): PlayerStat => ({
  name: "X",
  team: "KC",
  group,
  stats,
});

console.log("--- quarterbacks ---");

// Comp/ATT, passing yards, then rushing yards and both kinds of touchdown
// only when they happened.
const passer = readStatLine([
  stat("passing", { "C/ATT": "24/38", YDS: "300", TD: "3", INT: "1" }),
  stat("rushing", { CAR: "4", YDS: "42", TD: "1" }),
]);
eq(
  "the full afternoon",
  formatStatLine(passer, "QB"),
  "24/38 · 300 pass yds · 42 rush yds · 3 pass TD · 1 rush TD · 1 INT",
);

const pocket = readStatLine([
  stat("passing", { "C/ATT": "18/30", YDS: "205", TD: "0", INT: "0" }),
  stat("rushing", { CAR: "1", YDS: "0", TD: "0" }),
]);
eq(
  "no rushing yards, no touchdowns, so none are shown",
  formatStatLine(pocket, "QB"),
  "18/30 · 205 pass yds",
);
ok("and in particular no zero touchdowns", !formatStatLine(pocket, "QB").includes("0 pass TD"));

const rushingQb = readStatLine([
  stat("passing", { "C/ATT": "12/19", YDS: "140", TD: "0", INT: "0" }),
  stat("rushing", { CAR: "11", YDS: "88", TD: "2" }),
]);
eq(
  "a running quarterback shows the running",
  formatStatLine(rushingQb, "QB"),
  "12/19 · 140 pass yds · 88 rush yds · 2 rush TD",
);

console.log("\n--- running backs ---");

const back = readStatLine([
  stat("rushing", { CAR: "18", YDS: "104", TD: "1" }),
  stat("receiving", { REC: "3", YDS: "22", TD: "1", TGTS: "4" }),
]);
eq(
  "carries, both kinds of yards, both kinds of score",
  formatStatLine(back, "RB"),
  "18 car · 104 rush yds · 22 rec yds · 1 rush TD · 1 rec TD",
);

const grinder = readStatLine([stat("rushing", { CAR: "12", YDS: "31", TD: "0" })]);
eq(
  "a back who never caught one still shows a nought there",
  formatStatLine(grinder, "RB"),
  "12 car · 31 rush yds · 0 rec yds",
);

const stuffed = readStatLine([stat("rushing", { CAR: "2", YDS: "0", TD: "0" })]);
eq("two carries for nothing says so", formatStatLine(stuffed, "RB"), "2 car · 0 rush yds · 0 rec yds");

console.log("\n--- receivers and tight ends ---");

const receiver = readStatLine([
  stat("receiving", { REC: "7", YDS: "96", TD: "1", TGTS: "11" }),
]);
eq(
  "targets, catches, yards, score",
  formatStatLine(receiver, "WR"),
  "11 tgt · 7 rec · 96 rec yds · 1 rec TD",
);
eq("a tight end reads the same way", formatStatLine(receiver, "TE"), formatStatLine(receiver, "WR"));

const quiet = readStatLine([stat("receiving", { REC: "0", YDS: "0", TD: "0", TGTS: "3" })]);
eq(
  "thrown at three times and caught none",
  formatStatLine(quiet, "WR"),
  "3 tgt · 0 rec · 0 rec yds",
);

// ESPN omits the targets column on some responses. A man cannot have been
// thrown at fewer times than he caught, so catches are the floor.
const noTargets = readStatLine([stat("receiving", { REC: "5", YDS: "60", TD: "0" })]);
eq("with no targets column, catches stand in", formatStatLine(noTargets, "WR"), "5 tgt · 5 rec · 60 rec yds");

const altLabel = readStatLine([stat("receiving", { REC: "5", YDS: "60", TD: "0", TAR: "9" })]);
eq("ESPN's other spelling of the column is read too", altLabel.targets, 9);

console.log("\n--- turnovers ---");

const butterfingers = readStatLine([
  stat("rushing", { CAR: "9", YDS: "40", TD: "0" }),
  stat("fumbles", { FUM: "1", LOST: "1", REC: "0" }),
]);
ok("a lost fumble is named", formatStatLine(butterfingers, "RB").includes("1 fum lost"));

const clean = readStatLine([
  stat("rushing", { CAR: "9", YDS: "40", TD: "0" }),
  stat("fumbles", { FUM: "1", LOST: "0", REC: "1" }),
]);
ok("a fumble he recovered himself is not", !formatStatLine(clean, "RB").includes("fum lost"));

console.log("\n--- kickers ---");

const kicker = readStatLine([stat("kicking", { FG: "3/4", XP: "2/2", LONG: "54" })]);
eq("made over attempted, both kinds", formatStatLine(kicker, "K"), "3/4 FG · 2/2 XP");

console.log("\n--- defences ---");

const dstStats: PlayerStat[] = [
  { name: "A", team: "SEA", group: "defensive", stats: { SACKS: "2.5", TD: "0" } },
  { name: "B", team: "SEA", group: "defensive", stats: { SACKS: "1", TD: "0" } },
  { name: "C", team: "SEA", group: "interceptions", stats: { INT: "2", TD: "0" } },
];

const unit = scoreDefense(dstStats, "SEA", 17, {
  fumblesRecovered: 1,
  yardsAllowed: 288,
  kickReturnTouchdowns: 1,
  puntReturnTouchdowns: 0,
});

eq(
  "sacks, recoveries, takeaways, yards given up, and the return",
  formatStatLine(unit.line, "D/ST"),
  "3.5 sack · 1 FR · 2 INT · 288 yds allowed · 1 KORTD",
);

// Half sacks are real and must not be rounded away, but a whole one should not
// be written as "3.0".
ok("half a sack survives", formatStatLine(unit.line, "D/ST").includes("3.5"));

const punt = scoreDefense([], "SEA", 0, {
  yardsAllowed: 140,
  puntReturnTouchdowns: 1,
});
eq(
  "a punt return is a punt return, not a kickoff",
  formatStatLine(punt.line, "D/ST"),
  "0 sack · 0 FR · 0 INT · 140 yds allowed · 1 PRTD",
);
ok("and is never mislabelled", !formatStatLine(punt.line, "D/ST").includes("KORTD"));

const quietUnit = scoreDefense([], "SEA", 31, { yardsAllowed: 455 });
eq(
  "a unit that did nothing still says what it gave up",
  formatStatLine(quietUnit.line, "D/ST"),
  "0 sack · 0 FR · 0 INT · 455 yds allowed",
);
ok("with no return touchdowns invented", !/RTD/.test(formatStatLine(quietUnit.line, "D/ST")));

// Both kinds at once, which is rare but must not merge.
// 24 allowed rather than a shutout, so the ten-point shutout band does not
// drown out the thing being measured.
const both = scoreDefense([], "SEA", 24, {
  yardsAllowed: 200,
  kickReturnTouchdowns: 1,
  puntReturnTouchdowns: 1,
});
ok(
  "both returns are shown apart",
  formatStatLine(both.line, "D/ST").includes("1 KORTD") &&
    formatStatLine(both.line, "D/ST").includes("1 PRTD"),
);
// They score the same six apiece whichever way they came.
eq("and both score", both.points, 12);

console.log("\n--- the edges ---");

eq("nothing at all is an empty line, not a crash", formatStatLine(null, "QB"), "");
eq("an empty line for an empty player", formatStatLine({}, "QB"), "");
eq("and for a defence with no numbers", formatStatLine({}, "D/ST"), "");

// A position nobody recognises still gets what he did rather than a blank.
const unknown: StatLine = { carries: 3, rushYards: 20, rushTd: 1 };
ok("an unknown position falls back to what happened", formatStatLine(unknown, "").includes("20 rush yds"));

// Yards allowed is shown but never scored: the band is on points.
const lowYards = scoreDefense([], "SEA", 24, { yardsAllowed: 100 });
const highYards = scoreDefense([], "SEA", 24, { yardsAllowed: 500 });
eq("yards allowed does not move the score", lowYards.points, highYards.points);

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
