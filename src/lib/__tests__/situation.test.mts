import { createServer } from "node:http";
import { FINISHED_SCOREBOARD, LIVE_SCOREBOARD } from "./fixtures/espn-game.mts";

/**
 * Where the ball is, and the points by period.
 *
 * Both are new reads off a feed this app had never touched, added for the
 * gamecast's pitch graphic and its quarter columns. Neither could be checked
 * against a live response from where they were written, which is exactly why
 * situationOf treats every field as optional and why this exists: it tests the
 * parser against ESPN's documented shape rather than anybody's memory of it.
 *
 * The rule the parser is built on is that a wrong guess must cost the graphic
 * and nothing else — so the cases below include a response with the situation
 * missing, one with it half-filled, and one that has finished.
 */

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

let body: unknown = LIVE_SCOREBOARD;
const server = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const addr = server.address();
process.env.ESPN_API_BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

const { fetchScoreboard } = await import("../espn.ts");

console.log("--- a game being played ---");
{
  const [game] = await fetchScoreboard(2, 2);
  const s = game.situation!;
  ok("the situation comes through", Boolean(s));
  eq("who has the ball", s.possession, "SEA");
  eq("the down and the distance", [s.down, s.distance], [2, 6]);
  eq("where the ball is", s.yardLine, 66);
  eq("and where the sticks are", s.lineToGain, 72);
  eq("in ESPN's own words", s.downDistanceText, "2nd & 6 at NE 34");

  eq("each side's points by period", game.away?.linescores, [7, 14, 0]);
  eq("and the other side's", game.home?.linescores, [7, 3, 7]);
  eq("which add up to the score on the board",
    game.away?.linescores?.reduce((a, b) => a + b, 0), game.away?.score);
}

console.log("\n--- and one that has finished ---");
{
  body = FINISHED_SCOREBOARD;
  const [game] = await fetchScoreboard(2, 2);
  // A situation left on a finished game draws a pitch with the ball frozen
  // wherever the last snap died, which reads as a game still in play.
  eq("carries no situation, whatever the feed still holds", game.situation, null);
  eq("and no line scores it was not sent", game.home?.linescores, []);
}

console.log("\n--- and a feed that does not say ---");
{
  const bare = JSON.parse(JSON.stringify(LIVE_SCOREBOARD));
  delete bare.events[0].competitions[0].situation;
  body = bare;
  eq("no situation is null rather than a crash", (await fetchScoreboard(2, 2))[0].situation, null);

  const half = JSON.parse(JSON.stringify(LIVE_SCOREBOARD));
  half.events[0].competitions[0].situation = { possessionText: "SEA" };
  body = half;
  const s = (await fetchScoreboard(2, 2))[0].situation!;
  ok("a half-filled one still names who has the ball", s.possession === "SEA");
  eq("and admits it does not know the rest",
    [s.down, s.distance, s.yardLine, s.lineToGain], [null, null, null, null]);

  const noOwner = JSON.parse(JSON.stringify(LIVE_SCOREBOARD));
  noOwner.events[0].competitions[0].situation = { down: 2, distance: 6 };
  body = noOwner;
  eq("a situation with nobody holding the ball is not one",
    (await fetchScoreboard(2, 2))[0].situation, null);

  const junk = JSON.parse(JSON.stringify(LIVE_SCOREBOARD));
  junk.events[0].competitions[0].competitors[0].linescores = [{ value: 7 }, { value: "?" }];
  body = junk;
  eq("a period nobody can read is dropped rather than guessed",
    (await fetchScoreboard(2, 2))[0].home?.linescores, [7]);
}

console.log("\n--- the quarter and the clock ---");
{
  // ESPN's status carries the period and the seconds left in it beside the
  // state; the recorded fixture predates this read, so it is set here in
  // ESPN's shape: "3rd Quarter · 7:56" is period 3 with 476 seconds left.
  const clocked = JSON.parse(JSON.stringify(LIVE_SCOREBOARD));
  Object.assign(clocked.events[0].competitions[0].status, { period: 3, clock: 476, displayClock: "7:56" });
  body = clocked;
  const [game] = await fetchScoreboard(2, 2);
  eq("a game being played says which quarter", game.period, 3);
  eq("and how long is left in it, in seconds", game.clock, 476);

  body = LIVE_SCOREBOARD;
  const [bare] = await fetchScoreboard(2, 2);
  eq("a feed that does not say is null, not zero", [bare.period, bare.clock], [null, null]);

  const junk = JSON.parse(JSON.stringify(LIVE_SCOREBOARD));
  Object.assign(junk.events[0].competitions[0].status, { period: "third", clock: "soon" });
  body = junk;
  const [garbled] = await fetchScoreboard(2, 2);
  eq("and one that says something unreadable is null too", [garbled.period, garbled.clock], [null, null]);

  const over = JSON.parse(JSON.stringify(FINISHED_SCOREBOARD));
  Object.assign(over.events[0].competitions[0].status, { period: 4, clock: 0 });
  body = over;
  const [finished] = await fetchScoreboard(2, 2);
  eq("a finished game keeps no clock, whatever the feed still holds", [finished.period, finished.clock], [null, null]);
}

server.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
