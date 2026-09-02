/**
 * The whole live-scoring path, end to end: HTTP in, fantasy points out.
 *
 * ESPN is served from a local stub rather than mocked at the module boundary,
 * so the parser is exercised the way it will actually run — through fetch,
 * through the defensive readers, into the scorer. A mock of fetchGameDetail
 * would prove only that the arithmetic works on data already in the right
 * shape, and getting the shape right is most of the job.
 */

import { createServer, type Server } from "node:http";
import { SCOREBOARD, SUMMARY } from "./fixtures/espn-game.mts";

let failed = 0;

const near = (label: string, got: number, want: number) => {
  const pass = Math.abs(got - want) < 1e-6;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}: got ${got}, want ${want}`);
  if (!pass) failed++;
};

const ok = (label: string, got: boolean) => {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  if (!got) failed++;
};

const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}`}`);
  if (!pass) failed++;
};

// --- the stub ---------------------------------------------------------------

let requests: string[] = [];

function serve(): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      requests.push(req.url ?? "");
      const body = (req.url ?? "").startsWith("/summary") ? SUMMARY : SCOREBOARD;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server, base: `http://127.0.0.1:${port}` });
    });
  });
}

const { server, base } = await serve();

// espn.ts reads the base URL once, at import. Setting it after would be read
// far too late, which is why every import in this file is dynamic.
process.env.ESPN_API_BASE = base;

const { pullWeek, phaseOf } = await import("../live.ts");
const {
  readFieldGoals,
  readSafeties,
  readTwoPointConversions,
  readReturnTouchdowns,
  scoreDefense,
  fieldGoalPoints,
} = await import("../scoring.ts");
const { fetchGameDetail } = await import("../espn.ts");

// --- reading the summary ----------------------------------------------------

console.log("--- what the box score cannot see ---");

const detail = await fetchGameDetail("401671800");

eq("every scoring play is read", detail.plays.length, 8);

// The point of carrying the running score: a touchdown is worth six, seven or
// eight and only the scoreboard knows which.
eq(
  "each play is worth what the scoreboard says it was",
  detail.plays.map((p) => p.value),
  [3, 7, 7, 8, 2, 3, 6, 3],
);

const fgs = readFieldGoals(detail.plays);
eq("all three field goals, with their distances", fgs.get("Harrison Butker"), [54, 52, 22]);

const safeties = readSafeties(detail.plays);
eq("the safety belongs to Buffalo", safeties.get("BUF"), 1);
eq("and not to Kansas City", safeties.get("KC"), undefined);

const twos = readTwoPointConversions(detail.plays);
eq("the passer is credited", twos.scorers.get("Patrick Mahomes"), 1);
eq("and so is the receiver", twos.scorers.get("Travis Kelce"), 1);
eq("nothing is left unexplained", twos.unattributed, 0);
ok("the touchdown that was only worth seven is not a conversion", twos.scorers.size === 2);

// --- the kicker -------------------------------------------------------------

console.log("\n--- two long field goals are not one ---");

// 54 and 52 at five apiece, 22 at three, one miss at minus one.
near("with distances: 5 + 5 + 3 - 1", fieldGoalPoints(3, 4, [54, 52, 22], 54), 12);

// What the box score alone can do: one bonus, however many he kicked.
near("without them, the bonus lands once", fieldGoalPoints(3, 4, [], 54), 10);

// A partial list is not trusted at all — it would silently drop a made kick.
near("an incomplete list falls back rather than under-counting", fieldGoalPoints(3, 4, [54], 54), 10);

// --- the whole week ---------------------------------------------------------

console.log("\n--- the week, scored against a roster ---");

// The league's spelling of every name, including one ESPN writes differently.
const roster = [
  "Patrick Mahomes",
  "Isiah Pacheco",
  "Travis Kelce",
  "Harrison Butker",
  "Josh Allen",
  "James Cook",
  "Tyler Bass",
  "Kansas City Chiefs D/ST",
  "Buffalo Bills D/ST",
];

requests = [];
const week = await pullWeek(roster, "half");

eq("the week ESPN said", week.week, 5);
eq("no game failed", week.failed, []);
ok("the slate is over", week.state.phase === "final");
ok("and nothing is in progress", !week.state.live);
ok("but it did start", week.state.started);

const points = (name: string) => week.scores.get(name)?.points ?? null;

// 300 pass yds (12) + 1 TD (4) + 1 INT (-2) = 14, plus the conversion (2).
near("Mahomes, whom ESPN spells with a suffix", points("Patrick Mahomes")!, 16);
ok("and who is keyed by the league's spelling", week.scores.has("Patrick Mahomes"));
ok("not ESPN's", !week.scores.has("Patrick Mahomes II"));

// 7 rec (3.5 at half PPR) + 90 yds (9) + 1 TD (6) = 18.5, plus the conversion.
near("Kelce, who caught the conversion", points("Travis Kelce")!, 20.5);

// 80 rush yds (8) + 1 TD (6). His own fumble was recovered by his own side,
// so nothing is taken off him.
near("Pacheco, who fumbled and got it back", points("Isiah Pacheco")!, 14);

// 54 (5) + 52 (5) + 22 (3) - 1 miss + 1 XP.
near("Butker, with two from fifty-plus", points("Harrison Butker")!, 13);

// 250 pass (10) + 1 pass TD (4) + 2 INT (-4) + 40 rush (4) + 1 rush TD (6).
near("Allen, in two groups at once", points("Josh Allen")!, 20);

// 100 rush (10) + 3 rec (1.5) + 20 rec yds (2) + 1 TD (6) - 1 fumble lost (2).
near("Cook, who lost one", points("James Cook")!, 17.5);

// One extra point made, one missed.
near("Bass, who missed one", points("Tyler Bass")!, 0);

console.log("\n--- the defences ---");

// 3 sacks (3) + 2 INT (4) + 1 genuine recovery (2) + 15 allowed (band 1).
near("Kansas City allowed fifteen", points("Kansas City Chiefs D/ST")!, 10);

// 1 sack (1) + 1 INT (2) + 1 safety (2) + 24 allowed (band 0).
near("Buffalo, with the safety", points("Buffalo Bills D/ST")!, 5);

// The correction this is really about: Kansas City's own fumbles group shows
// two recoveries, but one of them is Pacheco falling on his own ball.
const naive = scoreDefense(detail.stats, "KC", 15);
near("counting a team's own recoveries over-credits it", naive.points, 12);
ok("the statLine names the safety when there is one", /1 SFTY/.test(
  scoreDefense(detail.stats, "BUF", 24, { safeties: 1 }).statLine,
));

console.log("\n--- what is asked of ESPN ---");

// One scoreboard, and one summary for the single game on it. A slate that has
// not kicked off should cost the scoreboard alone.
eq("one request per game plus the board", requests.length, 2);
ok("the scoreboard is pinned to the regular season", requests.some((u) => u.includes("seasontype=2")));

const upcoming = phaseOf([
  { state: "pre" } as never,
  { state: "pre" } as never,
]);
ok("a slate that has not started is upcoming", upcoming.phase === "upcoming" && !upcoming.started);

const inPlay = phaseOf([{ state: "post" } as never, { state: "in" } as never]);
ok("one game in progress makes the week live", inPlay.live && inPlay.started);

console.log("\n--- returns ---");

const returnTds = readReturnTouchdowns([
  { name: "Marvin Mims Jr.", team: "DEN", group: "puntReturns", stats: { TD: "1" } },
  { name: "Marvin Mims Jr.", team: "DEN", group: "kickReturns", stats: { TD: "1" } },
  { name: "Somebody", team: "DEN", group: "receiving", stats: { TD: "2" } },
]);
eq("both returns count, the receiving score does not", returnTds.get("DEN"), 2);

const withReturns = scoreDefense([], "DEN", 0, { returnTouchdowns: 1 });
near("a return touchdown scores for the unit", withReturns.points, 16);

// ---------------------------------------------------------------------------

server.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
