import { scoreGame, scoreGroup } from "../scoring";

const eq = (got, want, label) => {
  const ok = Math.abs(got - want) < 1e-9;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}: got ${got}, want ${want}`);
  if (!ok) process.exitCode = 1;
};

// 300 yds, 3 TD, 1 INT = 12 + 12 - 2 = 22
eq(scoreGroup({ name:"QB", team:"BUF", group:"passing", stats:{ "C/ATT":"24/38", YDS:"300", TD:"3", INT:"1" } }, "half"), 22, "passing");

// 100 yds, 1 TD = 10 + 6 = 16
eq(scoreGroup({ name:"RB", team:"BUF", group:"rushing", stats:{ CAR:"20", YDS:"100", TD:"1" } }, "half"), 16, "rushing");

// 8 rec, 90 yds, 1 TD, half PPR = 9 + 6 + 4 = 19
eq(scoreGroup({ name:"WR", team:"BUF", group:"receiving", stats:{ REC:"8", YDS:"90", TD:"1" } }, "half"), 19, "receiving half-ppr");
eq(scoreGroup({ name:"WR", team:"BUF", group:"receiving", stats:{ REC:"8", YDS:"90", TD:"1" } }, "ppr"), 23, "receiving full ppr");
eq(scoreGroup({ name:"WR", team:"BUF", group:"receiving", stats:{ REC:"8", YDS:"90", TD:"1" } }, "standard"), 15, "receiving standard");

// 3/4 FG long 52, 2/2 XP = 9 + 2(bonus) + 2 - 1(miss) = 12
eq(scoreGroup({ name:"K", team:"BUF", group:"kicking", stats:{ FG:"3/4", XP:"2/2", LONG:"52" } }, "half"), 12, "kicking w/ 50+ and a miss");
// same without the long bonus = 9 + 2 - 1 = 10
eq(scoreGroup({ name:"K", team:"BUF", group:"kicking", stats:{ FG:"3/4", XP:"2/2", LONG:"41" } }, "half"), 10, "kicking under 50");

eq(scoreGroup({ name:"X", team:"BUF", group:"fumbles", stats:{ LOST:"1" } }, "half"), -2, "fumble lost");
eq(scoreGroup({ name:"X", team:"BUF", group:"defensive", stats:{ TOT:"9" } }, "half"), 0, "unknown group scores zero");

// A dual-threat back appears in two groups and must be summed once.
const dual = scoreGame([
  { name:"Jahmyr Gibbs", team:"DET", group:"rushing", stats:{ CAR:"18", YDS:"120", TD:"2" } },
  { name:"Jahmyr Gibbs", team:"DET", group:"receiving", stats:{ REC:"4", YDS:"30", TD:"0" } },
], "half");
console.log(`${dual.length === 1 ? "PASS" : "FAIL"}  dual-group merges to one row (${dual.length})`);
eq(dual[0].points, 12 + 12 + 3 + 2, "dual-group total");
console.log("  statLine:", dual[0].statLine);

// rostered filter
const filtered = scoreGame([
  { name:"Rostered Guy", team:"DET", group:"rushing", stats:{ CAR:"1", YDS:"10", TD:"0" } },
  { name:"Nobody", team:"DET", group:"rushing", stats:{ CAR:"1", YDS:"10", TD:"0" } },
], "half", new Set(["Rostered Guy"]));
console.log(`${filtered.length === 1 && filtered[0].name === "Rostered Guy" ? "PASS" : "FAIL"}  rostered filter`);

// malformed input must not throw
eq(scoreGroup({ name:"X", team:"", group:"passing", stats:{} }, "half"), 0, "empty stats");
eq(scoreGroup({ name:"X", team:"", group:"passing", stats:{ YDS:"--", TD:"", INT:undefined } }, "half"), 0, "junk stats");

// --- team defense ---------------------------------------------------------
import { scoreDefense } from "../scoring";

const dstStats = (team) => [
  { name:"A", team, group:"defensive",     stats:{ SACKS:"2.5", TD:"0" } },
  { name:"B", team, group:"defensive",     stats:{ SACKS:"1", TD:"1" } },
  { name:"C", team, group:"interceptions", stats:{ INT:"2", TD:"0" } },
  { name:"D", team, group:"fumbles",       stats:{ REC:"1", LOST:"0" } },
  // another team's line must not leak into this unit
  { name:"E", team:"XXX", group:"defensive", stats:{ SACKS:"9", TD:"3" } },
];

// 3.5 sacks + 2 INT(4) + 1 FR(2) + 1 TD(6) = 15.5, plus the shutout band 10
eq(scoreDefense(dstStats("SEA"), "SEA", 0).points, 25.5, "D/ST shutout");
eq(scoreDefense(dstStats("SEA"), "SEA", 3).points, 22.5, "D/ST 1-6 allowed");
eq(scoreDefense(dstStats("SEA"), "SEA", 13).points, 19.5, "D/ST 7-13 allowed");
eq(scoreDefense(dstStats("SEA"), "SEA", 20).points, 16.5, "D/ST 14-20 allowed");
eq(scoreDefense(dstStats("SEA"), "SEA", 24).points, 15.5, "D/ST 21-27 allowed");
eq(scoreDefense(dstStats("SEA"), "SEA", 30).points, 14.5, "D/ST 28-34 allowed");
eq(scoreDefense(dstStats("SEA"), "SEA", 42).points, 11.5, "D/ST 35+ allowed");

// band boundaries are inclusive on the upper edge
eq(scoreDefense([], "SEA", 6).points, 7, "6 allowed is the 1-6 band");
eq(scoreDefense([], "SEA", 7).points, 4, "7 allowed drops a band");
eq(scoreDefense([], "SEA", 27).points, 0, "27 allowed scores nothing");
eq(scoreDefense([], "SEA", 28).points, -1, "28 allowed goes negative");

// a defense with no plays and a blowout against it still scores the band
eq(scoreDefense([], "SEA", 0).points, 10, "empty shutout");
console.log("  D/ST line:", scoreDefense(dstStats("SEA"), "SEA", 13).statLine);
