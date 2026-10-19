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

console.log("\n--- which week the copy is read from ---");
{
  // A stand-in for the query builder: records the filters of every query and
  // answers from a table of rows, which is all mirroredSlate needs of it.
  type Row = Record<string, unknown>;
  const TABLE: Row[] = [
    { id: "a", season: 2025, week: 4, season_type: 2, starts_at: "2025-10-05T17:00:00Z", home_team: "NE", away_team: "BUF", home_score: 10, away_score: 20, state: "post", winner: "BUF", completed: true, updated_at: "2025-10-06T08:00:00Z" },
    { id: "b", season: 2026, week: 3, season_type: 2, starts_at: "2026-09-27T17:00:00Z", home_team: "NE", away_team: "SEA", home_score: 17, away_score: 21, state: "post", winner: "SEA", completed: true, updated_at: "2026-09-28T08:00:00Z" },
    { id: "c", season: 2026, week: 4, season_type: 2, starts_at: "2026-10-04T17:00:00Z", home_team: "KC", away_team: "LV", home_score: 0, away_score: 0, state: "pre", winner: null, completed: false, updated_at: "2026-09-29T08:00:00Z" },
  ];
  const fakeDb = () => ({
    from: () => {
      let rows = [...TABLE];
      const q = {
        select: () => q,
        eq: (col: string, v: unknown) => ((rows = rows.filter((r) => r[col] === v)), q),
        lte: (col: string, v: string) => ((rows = rows.filter((r) => String(r[col]) <= v)), q),
        order: (col: string, o: { ascending: boolean }) => (
          (rows = rows.sort((x, y) => (String(x[col]) < String(y[col]) ? -1 : 1) * (o.ascending ? 1 : -1))), q
        ),
        limit: (n: number) => ((rows = rows.slice(0, n)), q),
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => void) => resolve({ data: rows, error: null }),
      };
      return q;
    },
  });
  const { mirroredSlate } = await import("../scoreboard-mirror.ts");
  const db = fakeDb() as unknown as Parameters<typeof mirroredSlate>[0];

  const named = await mirroredSlate(db, { season: 2025, week: 4, seasonType: 2 });
  eq("a week and a season named is that week of that season", named?.games.map((g) => g.id), ["a"]);

  const weekOnly = await mirroredSlate(db, { week: 4, seasonType: 2 });
  eq("a week named without a season is that week of the latest season", weekOnly?.games.map((g) => g.id), ["c"]);

  const nothing = await mirroredSlate(db, {});
  eq("nothing named is the latest week that has started", nothing?.games.map((g) => g.id), ["b"]);
  eq("and says when the league last heard", nothing?.asOf, "2026-09-28T08:00:00Z");

  eq("a week the mirror has never seen is nothing to stand in with", await mirroredSlate(db, { week: 17, seasonType: 2 }), null);
}

server.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
