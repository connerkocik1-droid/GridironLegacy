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
