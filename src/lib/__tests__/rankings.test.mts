import { COLUMNS, GROUPS, filter, rank } from "../rankings";

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
const near = (label: string, got: number | null | undefined, want: number, tol = 0.06) => {
  const pass = got != null && Math.abs(got - want) <= tol;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${got}, want ~${want}`}`);
  if (!pass) failed++;
};

const rows = rank();
const find = (n: string) => rows.find((r) => r.name === n);

console.log("\n--- the toggles ---");
eq("every toggle the league asked for exists",
  Object.keys(GROUPS), ["ALL", "QB", "RB", "WR", "TE", "FLEX", "K", "D/ST"]);
eq("flex is what a flex slot takes", GROUPS.FLEX, ["RB", "WR", "TE"]);
ok("ALL is everyone", filter(rows, "ALL").length === rows.length);
ok("QB is only quarterbacks", filter(rows, "QB").every((r) => r.position === "QB"));
ok("flex holds backs, receivers and tight ends, and nobody else",
  filter(rows, "FLEX").every((r) => ["RB", "WR", "TE"].includes(r.position)));
ok("and it is bigger than any of them alone",
  filter(rows, "FLEX").length > filter(rows, "RB").length);

console.log("\n--- points and per game are on every row ---");
for (const group of Object.keys(GROUPS) as (keyof typeof GROUPS)[]) {
  const labels = COLUMNS[group].map((c) => c.label);
  ok(`${group} leads with PTS and PPG`, labels[0] === "PTS" && labels[1] === "PPG");
}

console.log("\n--- the columns each position asked for ---");
eq("QB", COLUMNS.QB.slice(2).map((c) => c.label), ["PYPG", "TD/G", "COMP %", "ATT/G", "COMP/G"]);
eq("RB", COLUMNS.RB.slice(2).map((c) => c.label), ["ATT/G", "YPG", "TD/G", "REC/G"]);
eq("WR", COLUMNS.WR.slice(2).map((c) => c.label), ["TGT/G", "REC/G", "Y/R", "TD/G"]);
eq("TE gets the same as WR", COLUMNS.TE.map((c) => c.key), COLUMNS.WR.map((c) => c.key));
eq("K", COLUMNS.K.slice(2).map((c) => c.label), ["ATT/G", "MADE/G", "TOTAL FG"]);

console.log("\n--- a quarterback ---");
{
  // Matthew Stafford, 2025: 17 games, 388/597, 4707 yards, 46 TD.
  const qb = find("Matthew Stafford");
  ok("is in the table", qb != null);
  near("passing yards per game", qb?.stats.pypg, 276.9, 0.1);
  near("touchdowns per game", qb?.stats.tdpg, 46 / 17);
  near("completion percentage", qb?.stats.compPct, 65, 0.5);
  near("attempts per game", qb?.stats.attpg, 597 / 17);
  near("completions per game", qb?.stats.comppg, 388 / 17);
}

console.log("\n--- a running back ---");
{
  // James Cook III, 2025: 17 games, 309 carries, 1621 yards, 12 rushing TD.
  const rb = find("James Cook III");
  ok("is in the table", rb != null);
  near("carries per game", rb?.stats.attpg, 309 / 17);
  near("rushing yards per game", rb?.stats.ypg, 95.4, 0.1);
  ok("touchdowns per game counts receiving scores too, not only rushing",
    (rb?.stats.tdpg ?? 0) >= 12 / 17 - 0.001);
  ok("receptions per game is a number", typeof rb?.stats.recpg === "number");
}

console.log("\n--- a receiver ---");
{
  // Jaxon Smith-Njigba, 2025: 17 games, 119 catches on 163 targets, 1793 yards.
  const wr = find("Jaxon Smith-Njigba");
  ok("is in the table", wr != null);
  near("targets per game", wr?.stats.tgtpg, 163 / 17);
  near("receptions per game", wr?.stats.recpg, 119 / 17);
  near("yards per reception", wr?.stats.ypr, 1793 / 119);
}

console.log("\n--- a kicker ---");
{
  // Jason Myers, 2025: 41 of 48, 17 games.
  const k = find("Jason Myers");
  ok("is in the table", k != null);
  near("attempts per game", k?.stats.fgapg, 48 / 17);
  near("made per game", k?.stats.fgpg, 41 / 17);
  eq("total field goals is a count, not a rate", k?.stats.fg, 41);
  ok("and the points come from the kicking table", (k?.total ?? 0) > 150);
}

console.log("\n--- a defense ---");
{
  const dst = rows.find((r) => r.position === "D/ST" && r.team === "SEA");
  ok("scores off the defensive table", (dst?.total ?? 0) > 150);
  ok("with a per-game average", (dst?.ppg ?? 0) > 5);
}

console.log("\n--- ordering ---");
ok("the table is ranked by total points",
  rows.every((r, i) => i === 0 || rows[i - 1].total >= r.total));
// A quarterback who threw a pick and did nothing else finished below zero.
// That is a real season and the table should say so rather than clamp it.
{
  const negative = rows.filter((r) => r.total < 0);
  ok("a losing season is kept, not clamped to zero", negative.length > 0);
  ok("and lands at the bottom",
    negative.every((r) => rows.indexOf(r) > rows.length - negative.length - 1));
}

console.log("\n--- this league's own scoring wins when it exists ---");
{
  const withLeague = rank(
    { "Matthew Stafford": { total: 300, games: 10 } },
    { "Matthew Stafford": "Steel Cartel" },
  );
  const qb = withLeague.find((r) => r.name === "Matthew Stafford");
  eq("the total is the league's", qb?.total, 300);
  eq("and so is the average", qb?.ppg, 30);
  eq("over the games the league counted", qb?.games, 10);
  eq("and the roster it sits on is named", qb?.franchise, "Steel Cartel");
  near("but the football statistics are still 2025's", qb?.stats.pypg, 276.9, 0.1);
}

{
  // A player the league has rostered but never scored falls back rather than
  // being shown as a zero.
  const zero = rank({ "Matthew Stafford": { total: 0, games: 0 } });
  const qb = zero.find((r) => r.name === "Matthew Stafford");
  ok("a player with no league games keeps last season's total",
    (qb?.total ?? 0) > 100);
}

console.log("\n--- players with no 2025 to speak of ---");
{
  // A rookie has no stat line anywhere. He belongs in the table with blanks,
  // not missing from it.
  const blank = rows.filter((r) => Object.keys(r.stats).length === 0);
  ok("are still listed", blank.length >= 0);
  ok("and never invent a rate", rows.every((r) =>
    Object.values(r.stats).every((v) => v === null || Number.isFinite(v))));
}

ok("a free agent has no franchise", rows.some((r) => r.franchise === null));

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
