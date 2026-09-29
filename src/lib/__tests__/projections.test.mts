/**
 * Projections in the league's own format.
 *
 * The scorer has always read the reception rule from the league's settings.
 * The projections did not: they carried a half point a catch of their own, so
 * when the league went to full PPR in 0038 the scores followed and every
 * projection stayed behind. Trey McBride, 126 catches in 17 games, projected
 * 14.9 a week in a league that scores him 18.6 for the same season.
 *
 * These pin the two together: one table of what a catch is worth, read by the
 * scorer and the projections alike, and a default that is the scorer's
 * default.
 */

import { proj } from "../roster";
import { bestLineup, type Score } from "../matchup";
import { scoreGroup } from "../scoring";
import {
  DEFAULT_SCORING,
  RECEPTION_POINTS,
  isScoringFormat,
  scoringOf,
} from "../scoring-format";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!pass) failed++;
};
const near = (label: string, got: number, want: number, within = 0.051) => {
  const pass = Math.abs(got - want) <= within;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${got}, want ${want}`}`);
  if (!pass) failed++;
};

console.log("--- reading the format ---");

eq("full PPR is read as it is written", scoringOf({ scoring: "ppr" }), "ppr");
eq("half PPR is read as it is written", scoringOf({ scoring: "half" }), "half");
eq("standard is read as it is written", scoringOf({ scoring: "standard" }), "standard");
eq("a league that says nothing is full PPR, as the scorer assumes", scoringOf({}), "ppr");
eq("no settings at all is the same default", scoringOf(null), DEFAULT_SCORING);
eq("a value nobody recognises is not a fourth format", scoringOf({ scoring: "0.75" }), "ppr");
eq("and is not taken for one", isScoringFormat("points-per-first-down"), false);

console.log("\n--- one table, two readers ---");

// The scorer's catch value is the table's catch value, format by format.
for (const format of ["standard", "half", "ppr"] as const) {
  const withCatches = scoreGroup(
    { name: "X", team: "ARI", group: "receiving", stats: { REC: "8", YDS: "0", TD: "0" } },
    format,
  );
  eq(`the scorer pays ${RECEPTION_POINTS[format]} a catch in ${format}`, withCatches, 8 * RECEPTION_POINTS[format]);
}

console.log("\n--- a pass-catcher, projected in each format ---");

// 2025: 126 catches, 1,239 yards, 11 touchdowns in 17 games, and nothing else.
near("McBride in full PPR is 18.6 a week", proj("Trey McBride", "ppr"), 18.6);
near("in half PPR, 14.9 — what every format used to be told", proj("Trey McBride", "half"), 14.9);
near("in standard, 11.2", proj("Trey McBride", "standard"), 11.2);
near("omitting the format means the league default, full PPR", proj("Trey McBride"), proj("Trey McBride", "ppr"), 0);

// A full point a catch over standard is catches per game, to rounding.
near(
  "full PPR over standard is his catches per game",
  proj("Trey McBride", "ppr") - proj("Trey McBride", "standard"),
  126 / 17,
  0.1,
);

console.log("\n--- nobody else moves ---");

// A quarterback with no receiving line is the same in every format.
eq(
  "a quarterback without a catch projects the same in every format",
  new Set(["standard", "half", "ppr"].map((f) => proj("Josh Allen", f as "ppr"))).size,
  1,
);
eq(
  "a kicker projects the same in every format",
  new Set(["standard", "half", "ppr"].map((f) => proj("Brandon Aubrey", f as "ppr"))).size,
  1,
);

console.log("\n--- the lineup projects in the league's format ---");

const SMALL = { starters: { TE: 1 }, bench: 2 };
const none = new Map<string, Score>();

const inPpr = bestLineup(["Trey McBride"], { ...SMALL, scoring: "ppr" }, none, "projection");
const inHalf = bestLineup(["Trey McBride"], { ...SMALL, scoring: "half" }, none, "projection");
const unset = bestLineup(["Trey McBride"], SMALL, none, "projection");

eq("a full-PPR league projects him in full PPR", inPpr[0]?.entry?.projected, proj("Trey McBride", "ppr"));
eq("a half-PPR league projects him in half", inHalf[0]?.entry?.projected, proj("Trey McBride", "half"));
eq("a league with no setting projects him in the default", unset[0]?.entry?.projected, proj("Trey McBride"));
eq(
  "and before kickoff his points are that projection",
  inPpr[0]?.entry?.points,
  proj("Trey McBride", "ppr"),
);

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
