import { gameLabel, kickoffLabel, onBye, opponentLabel, teamGames } from "../nfl-week";

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

const ROWS = [
  { home_team: "LV", away_team: "MIA", starts_at: "2026-09-13T19:25:00Z", state: "pre" },
  { home_team: "NO", away_team: "DET", starts_at: "2026-09-13T16:00:00Z", state: "in" },
  { home_team: "NYG", away_team: "DAL", starts_at: "2026-09-13T23:20:00Z", state: "post" },
];

console.log("--- the week, keyed by team ---");
{
  const week = teamGames(ROWS);
  eq("both sides of a game are in it", [week.LV.opponent, week.MIA.opponent], ["MIA", "LV"]);
  eq("the away side travels", [week.LV.away, week.MIA.away], [false, true]);
  eq("and they share a state", [week.NO.state, week.DET.state], ["in", "in"]);
  eq("every team that played is there", Object.keys(week).sort(),
    ["DAL", "DET", "LV", "MIA", "NO", "NYG"]);
  eq("a state nobody recognises is treated as not started",
    teamGames([{ ...ROWS[0], state: "nonsense" }]).LV.state, "pre");
}

console.log("\n--- how it reads under a name ---");
{
  const week = teamGames(ROWS);
  eq("at home, no marker", opponentLabel(week.LV), "MIA");
  eq("away, an at-sign", opponentLabel(week.MIA), "@LV");
  eq("nobody at all is nothing at all", opponentLabel(null), "");
  ok("a game to come names the day and the time", /^MIA \w{3} \d/.test(gameLabel(week.LV)));
  eq("a game under way says so", gameLabel(week.DET), "@NO Live");
  eq("and a finished one says that", gameLabel(week.DAL), "@NYG Final");
}

console.log("\n--- kickoff ---");
{
  ok("a real time reads as a day and a clock", /^\w{3} \d{1,2}:\d{2}/.test(kickoffLabel("2026-09-13T16:00:00Z")));
  eq("no time is no label", kickoffLabel(null), "");
  eq("and nor is a broken one", kickoffLabel("not a date"), "");
}

console.log("\n--- byes ---");
{
  const week = teamGames(ROWS);
  ok("a team with no game this week is on a bye", onBye(week, "SEA"));
  ok("a team with one is not", !onBye(week, "LV"));
  // A free agent has no team, which is not a bye — it is nobody.
  ok("an empty team is not on a bye", !onBye(week, ""));
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
