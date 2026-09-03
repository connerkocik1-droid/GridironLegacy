/**
 * The club team sheet, which is where a position comes from when the game
 * itself will not say.
 *
 * This exists because the alternative was a guess. A box score names a
 * position for some players and not others — never for defensive players, and
 * often not for the camp bodies a preseason game is mostly made of — and the
 * old fallback inferred one from the columns a man appeared in. That cannot
 * tell a tight end from a receiver or a fullback from a back, which is exactly
 * the distinction a lineup slot turns on, so it produced a confident label
 * that was sometimes wrong and never said so.
 *
 * Three things have to hold. Both response shapes must parse, because ESPN
 * returns the squad grouped by unit on most clubs and flat on some, and a club
 * that answers the other way would silently lose every position. The sheet
 * must be cached, because this sits behind a twenty-second live refresh. And a
 * club that cannot be fetched must cost a position rather than a whole week's
 * scoring.
 */

import { createServer, type Server } from "node:http";

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

/** Grouped into units — what the endpoint returns for most clubs. */
const GROUPED = {
  athletes: [
    {
      position: "offense",
      items: [
        { id: "1", displayName: "Grouped Passer", position: { abbreviation: "QB" } },
        { id: "2", displayName: "Grouped Blocker", position: { abbreviation: "FB" } },
        // No position at all. Skipped rather than stored as an empty string,
        // which would answer a later lookup with a blank.
        { id: "3", displayName: "Nameless Role" },
      ],
    },
    {
      position: "defense",
      items: [{ id: "4", displayName: "Grouped Tackler", position: { abbreviation: "DT" } }],
    },
  ],
};

/** Flat — the other shape seen in the wild. */
const FLAT = {
  athletes: [
    { id: "9", fullName: "Flat Receiver", position: { abbreviation: "WR" } },
    { id: "10", displayName: "Flat Kicker", position: { abbreviation: "PK" } },
  ],
};

let asked: string[] = [];

const server: Server = await new Promise((resolve) => {
  const s = createServer((req, res) => {
    const url = req.url ?? "";
    asked.push(url);

    if (url.includes("/teams/gone/roster")) {
      res.writeHead(503, { "content-type": "application/json" });
      return res.end("{}");
    }

    const body = url.includes("/teams/flat/roster")
      ? FLAT
      : url.includes("/teams/grp/roster")
        ? GROUPED
        : { athletes: [] };

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  });
  s.listen(0, "127.0.0.1", () => resolve(s));
});

const addr = server.address();
process.env.ESPN_API_BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

const { fetchTeamRoster, forgetTeamRosters, withTeamPositions } = await import("../espn.ts");

console.log("--- a squad grouped into units ---");

const grouped = await fetchTeamRoster("GRP");
eq("the passer is found by name", grouped.get("grouped passer"), "QB");
eq("and by id", grouped.get("#1"), "QB");
eq("a defensive unit is walked too", grouped.get("grouped tackler"), "DT");
eq("ESPN's own word is kept, not translated here", grouped.get("grouped blocker"), "FB");
ok("a player with no position is not stored as a blank", !grouped.has("nameless role"));

console.log("\n--- a flat squad ---");

const flat = await fetchTeamRoster("FLAT");
eq("fullName is read when displayName is absent", flat.get("flat receiver"), "WR");
eq("and displayName when it is there", flat.get("flat kicker"), "PK");
eq("by id as well", flat.get("#9"), "WR");

console.log("\n--- the sheet is fetched once ---");

// A live refresh runs every twenty seconds over thirteen games. Re-fetching a
// club's squad each time would be hundreds of requests an afternoon for a list
// that changes about once a week.
const before = asked.filter((u) => u.includes("/teams/grp/")).length;
await fetchTeamRoster("GRP");
await fetchTeamRoster("grp");
const after = asked.filter((u) => u.includes("/teams/grp/")).length;
eq("a repeat asks nobody", after, before);
eq("and the case of the abbreviation does not make it a different club", after, 1);

forgetTeamRosters();
await fetchTeamRoster("GRP");
eq("forgetting them asks again", asked.filter((u) => u.includes("/teams/grp/")).length, 2);

console.log("\n--- a club that cannot be fetched ---");

const gone = await fetchTeamRoster("GONE");
eq("costs a position, not the week", gone.size, 0);

console.log("\n--- filling in what a game did not say ---");

forgetTeamRosters();
asked = [];

const filled = await withTeamPositions([
  { name: "Grouped Passer", team: "GRP", group: "passing", stats: {} },
  { name: "Flat Receiver", team: "FLAT", group: "receiving", stats: {} },
]);
eq("a missing position is looked up", filled[0].position, "QB");
eq("on each club involved", filled[1].position, "WR");

// The common case: everybody already labelled. It must cost nothing at all,
// because it is the case on almost every regular-season game.
asked = [];
const untouched = await withTeamPositions([
  { name: "Grouped Passer", team: "GRP", group: "passing", stats: {}, position: "QB" },
]);
eq("a game that named everybody asks nobody", asked.length, 0);
eq("and is handed back as it was", untouched[0].position, "QB");

// One row of a player's own is enough. A back with "RB" on his rushing line
// and nothing on his fumbles line does not need his club's sheet fetching.
asked = [];
const twoRows = await withTeamPositions([
  { name: "Grouped Passer", team: "GRP", group: "passing", stats: {}, position: "QB" },
  { name: "Grouped Passer", team: "GRP", group: "fumbles", stats: {} },
]);
eq("a position on one row answers for the man", asked.length, 0);
eq("and is carried onto his other rows", twoRows[1].position, "QB");

// A club that answers with nothing leaves the position empty rather than
// inventing one. An admitted blank is the whole point of the change.
forgetTeamRosters();
const unknown = await withTeamPositions([
  { name: "Nobody At All", team: "NONE", group: "receiving", stats: {} },
]);
eq("a player nobody can name keeps no position", unknown[0].position, undefined);

server.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
