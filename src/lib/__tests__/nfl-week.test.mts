import {
  GAME_MINUTES,
  IN_PLAY_FLOOR,
  gameLabel,
  gameLeft,
  kickoffLabel,
  onBye,
  opponentLabel,
  teamGames,
} from "../nfl-week";

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

console.log("\n--- how much of a game is left ---");
{
  const KICKOFF = "2026-09-13T17:00:00Z";
  const at = (minutes: number) => Date.parse(KICKOFF) + minutes * 60_000;
  const game = (extra: Record<string, unknown>) =>
    ({ home_team: "NO", away_team: "DET", starts_at: KICKOFF, state: "in", ...extra });
  const close = (label: string, got: number, want: number) =>
    ok(`${label}${Math.abs(got - want) <= 0.001 ? "" : ` — got ${got}, want ${want}`}`, Math.abs(got - want) <= 0.001);

  eq("before kickoff, all of it", gameLeft(game({ state: "pre" })), 1);
  eq("after the whistle, none of it", gameLeft(game({ state: "post", period: 4, clock: 0 })), 0);

  // The clock, where the mirror has it.
  close("8:45 into the second quarter is two quarters and 8:45 to go",
    gameLeft(game({ period: 2, clock: 525 })), (2 * 900 + 525) / 3600);
  close("halftime is half", gameLeft(game({ period: 2, clock: 0 })), 0.5);
  close("two minutes left in the fourth is a thirtieth of a game",
    gameLeft(game({ period: 4, clock: 120 })), 120 / 3600);
  eq("a fourth quarter run down is not over until the whistle", gameLeft(game({ period: 4, clock: 0 })), IN_PLAY_FLOOR);
  close("overtime counts only what is left of the extra period",
    gameLeft(game({ period: 5, clock: 600 })), 600 / 3600);
  close("a clock past a quarter's length is read as a full quarter",
    gameLeft(game({ period: 1, clock: 5000 })), 1);

  // Without it, the time since kickoff.
  close("no clock, halfway through a game's usual length is half",
    gameLeft(game({}), at(GAME_MINUTES / 2)), 0.5);
  eq("no clock, long past the usual length is the floor, not over",
    gameLeft(game({}), at(GAME_MINUTES + 40)), IN_PLAY_FLOOR);
  eq("a clock that is half there is no clock",
    gameLeft(game({ period: 3, clock: null }), at(GAME_MINUTES / 2)), 0.5);
  eq("no clock and no kickoff either is the middle", gameLeft(game({ starts_at: "not a date" })), 0.5);

  const week = teamGames([game({ period: 3, clock: 450 })], at(100));
  close("both sides of a game carry what is left of it", week.NO.left, (900 + 450) / 3600);
  eq("the same share for each", week.NO.left, week.DET.left);
  eq("a game to come has all of it", teamGames(ROWS).LV.left, 1);
  eq("and a finished one none", teamGames(ROWS).DAL.left, 0);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
