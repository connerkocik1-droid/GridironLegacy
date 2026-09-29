/**
 * The scoreboard when ESPN will not answer.
 *
 * In week 3 ESPN's scoreboard refused this server twenty-three times, and each
 * refusal was answered by asking again on the next poll — and by the board on
 * every phone emptying mid-Sunday. Two things change that and both are tested
 * here: a host that refuses is left alone for a while, so the block has a
 * chance to lift; and the board stands in with the league's own copy of the
 * week, marked as such, instead of going blank.
 */

import { createServer } from "node:http";
import { LIVE_SCOREBOARD } from "./fixtures/espn-game.mts";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!pass) failed++;
};
const ok = (label: string, got: boolean) => {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  if (!got) failed++;
};

// A stand-in for ESPN that answers from a script and counts what it was asked.
let script: { status: number; headers?: Record<string, string> }[] = [];
let asked = 0;
const server = createServer((_req, res) => {
  asked++;
  const next = script.shift() ?? { status: 200 };
  res.writeHead(next.status, { "content-type": "application/json", ...(next.headers ?? {}) });
  res.end(next.status === 200 ? JSON.stringify(LIVE_SCOREBOARD) : "{}");
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const addr = server.address();
const BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
process.env.ESPN_API_BASE = BASE;

const { EspnBackoffError, espnBlockedUntil, fetchScoreboard, resetEspnBackoff } = await import("../espn.ts");
const { gameFromMirror, mirrorStatus } = await import("../scoreboard-mirror.ts");

const attempt = async () => {
  try {
    await fetchScoreboard(3, 2, 2026);
    return "ok";
  } catch (err) {
    return err instanceof EspnBackoffError ? "backing off" : String((err as Error).message).slice(0, 9);
  }
};

console.log("--- a host that refuses is left alone ---");
{
  resetEspnBackoff();
  asked = 0;
  script = [{ status: 403 }];

  eq("the refusal is reported", await attempt(), "ESPN 403 ");
  eq("and the next call does not go out at all", await attempt(), "backing off");
  eq("so ESPN heard from us once, not twice", asked, 1);

  const wait = espnBlockedUntil(`${BASE}/scoreboard`) - Date.now();
  ok(`for about thirty seconds (${Math.round(wait / 1000)}s)`, wait > 25_000 && wait <= 30_000);
  eq("another host is not held up by it", espnBlockedUntil("https://sports.core.api.espn.com/v2/x"), 0);

  resetEspnBackoff();
  eq("once the wait is over it asks again", await attempt(), "ok");
  eq("and a success leaves nothing to wait for", espnBlockedUntil(`${BASE}/scoreboard`), 0);
}
{
  resetEspnBackoff();
  script = [{ status: 429, headers: { "retry-after": "120" } }];
  await attempt();
  const wait = espnBlockedUntil(`${BASE}/scoreboard`) - Date.now();
  ok(`"slow down" with a Retry-After is waited out as asked (${Math.round(wait / 1000)}s)`, wait > 115_000 && wait <= 120_000);
}
{
  resetEspnBackoff();
  script = [{ status: 500 }];
  eq("a server error is an error", await attempt(), "ESPN 500 ");
  eq("but not a refusal, so the next call still goes out", await attempt(), "ok");
  resetEspnBackoff();
}

console.log("\n--- the league's own copy of the week ---");
{
  const row = {
    id: "401",
    season: 2026,
    week: 3,
    season_type: 2,
    starts_at: "2026-09-27T17:00:00Z",
    home_team: "NE",
    away_team: "SEA",
    home_score: 17,
    away_score: 21,
    state: "in",
    winner: null,
    completed: false,
    updated_at: "2026-09-27T19:12:00Z",
    period: 3,
    clock: 476,
  };

  eq("a live quarter reads the way ESPN writes it", mirrorStatus(row), "7:56 - 3rd");
  eq("halftime is halftime", mirrorStatus({ ...row, period: 2, clock: 0 }), "Halftime");
  eq("the end of a quarter says so", mirrorStatus({ ...row, period: 3, clock: 0 }), "End of 3rd");
  eq("overtime is OT", mirrorStatus({ ...row, period: 5, clock: 305 }), "5:05 - OT");
  eq("a quarter with no clock is just the quarter", mirrorStatus({ ...row, clock: null }), "3rd");
  eq("no quarter at all is left for the board to call LIVE", mirrorStatus({ ...row, period: null }), "");
  eq("a game not being played has no status line", mirrorStatus({ ...row, state: "post" }), "");

  const game = gameFromMirror(row);
  eq("it is drawn as the same game", [game.id, game.week, game.state], ["401", 3, "in"]);
  eq("with the score the league last heard", [game.away?.score, game.home?.score], [21, 17]);
  eq("and the sides the right way round", [game.home?.abbrev, game.away?.abbrev], ["NE", "SEA"]);
  eq("with its clock", [game.period, game.clock, game.statusDetail], [3, 476, "7:56 - 3rd"]);

  const final = gameFromMirror({ ...row, state: "post", completed: true, winner: "SEA", period: 4, clock: 0 });
  eq("a finished game names its winner", [final.away?.winner, final.home?.winner], [true, false]);
  eq("and keeps no clock", [final.period, final.clock], [null, null]);
  eq("a state nobody recognises is a game to come", gameFromMirror({ ...row, state: "weird" }).state, "pre");
}

server.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
