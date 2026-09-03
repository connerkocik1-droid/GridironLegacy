/**
 * The play-by-play feed, from ESPN's core API.
 *
 * A different host and a different shape from everything else this app reads,
 * and the differences are the whole of what can go wrong. The core API names a
 * team by a reference URL rather than an abbreviation. It paginates, so a game
 * arrives in pieces and a reader that stops at the first page silently loses
 * the second half. And its ordering lives in a zero-padded sequence string,
 * not in the order the items happen to arrive.
 *
 * Nothing here scores points — the box score does that, and does it already.
 * This is the drive feed, so a page that fails to load costs some plays rather
 * than a week of scoring, and that is checked too.
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

const ref = (id: number) =>
  `http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/teams/${id}?lang=en&region=us`;

const play = (over: Record<string, unknown>) => ({
  id: "p", sequenceNumber: "000100", type: { text: "Rush" }, text: "a run",
  period: { number: 1 }, clock: { displayValue: "15:00" },
  team: { $ref: ref(12) }, scoringPlay: false, homeScore: 0, awayScore: 0,
  ...over,
});

// Two pages, deliberately out of order within them, so the sort is doing work
// rather than agreeing with the order things arrived in.
const PAGES: Record<string, unknown> = {
  "1": {
    pageIndex: 1, pageCount: 2, items: [
      play({ id: "b", sequenceNumber: "000205", type: { text: "Passing Touchdown" },
             text: "Mahomes to Kelce, TOUCHDOWN", period: { number: 2 },
             clock: { displayValue: "03:31" }, scoringPlay: true, homeScore: 7, awayScore: 0 }),
      play({ id: "a", sequenceNumber: "000101", text: "Pacheco run for 18 yds" }),
    ],
  },
  "2": {
    pageIndex: 2, pageCount: 2, items: [
      play({ id: "c", sequenceNumber: "000410", type: { text: "Field Goal Good" },
             text: "Bass 41 yd Field Goal Good", period: { number: 4 },
             clock: { displayValue: "00:41" }, team: { $ref: ref(2) },
             scoringPlay: true, homeScore: 7, awayScore: 3 }),
    ],
  },
};

let asked: string[] = [];
let brokenPage: string | null = null;

const server: Server = await new Promise((resolve) => {
  const s = createServer((req, res) => {
    const url = req.url ?? "";
    asked.push(url);

    const page = /[?&]page=(\d+)/.exec(url)?.[1] ?? "1";

    if (url.includes("/events/broken/")) {
      res.writeHead(500, { "content-type": "application/json" });
      return res.end("{}");
    }
    if (url.includes("/events/empty/")) {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ pageIndex: 1, pageCount: 1, items: [] }));
    }
    if (brokenPage && page === brokenPage) {
      res.writeHead(503, { "content-type": "application/json" });
      return res.end("{}");
    }

    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify(PAGES[page] ?? { pageIndex: Number(page), pageCount: 2, items: [] }));
  });
  s.listen(0, "127.0.0.1", () => resolve(s));
});

const addr = server.address();
process.env.ESPN_CORE_API_BASE = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

const { fetchPlayByPlay, teamIdFromRef } = await import("../espn.ts");

console.log("--- a whole game, in order ---");

const feed = await fetchPlayByPlay("401671800");
eq("both pages are read, not just the first", feed.length, 3);
eq(
  "and the plays come back in the order they were played",
  feed.map((p) => p.id),
  ["a", "b", "c"],
);

console.log("\n--- what a play says ---");

const td = feed[1];
eq("the text is ESPN's own", td.text, "Mahomes to Kelce, TOUCHDOWN");
eq("with what kind of play it was", td.type, "Passing Touchdown");
eq("the quarter", td.period, 2);
eq("and the clock", td.clock, "03:31");
ok("a scoring play says so", td.scoring);
ok("and one that is not, does not", !feed[0].scoring);
eq("the running score is carried", `${td.awayScore}-${td.homeScore}`, "0-7");

console.log("\n--- the team, which the core API gives as a reference ---");

// The site API would simply have said "KC". Following the reference would be
// a request per play, and the id is already in the URL.
eq("the id is read out of the reference URL", td.teamId, "12");
eq("and the other club's", feed[2].teamId, "2");
eq("a reference to nothing is empty, not a crash", teamIdFromRef(undefined), "");
eq("so is one that is not a URL", teamIdFromRef({ href: "..." }), "");
eq("and one with no team in it", teamIdFromRef("http://example.com/athletes/9"), "");

console.log("\n--- when the feed will not load ---");

// This is the drive feed, not the scorer. A game whose plays cannot be read
// costs the feed and nothing else, so it must come back empty rather than
// throw into a page that was only ever going to show a list of plays.
asked = [];
eq("a game that answers 500 costs the feed, not the week",
   (await fetchPlayByPlay("broken")).length, 0);

eq("a game with no plays yet is empty too",
   (await fetchPlayByPlay("empty")).length, 0);

// Half a feed is still a feed. Losing page two must not lose page one.
brokenPage = "2";
const partial = await fetchPlayByPlay("401671800");
brokenPage = null;
eq("a page that fails keeps the pages that did not", partial.length, 2);
eq("and they are still in order", partial.map((p) => p.id), ["a", "b"]);

console.log("\n--- what it asks for ---");

asked = [];
await fetchPlayByPlay("401671800");
ok("it stops when ESPN says there are no more pages", asked.length === 2);
ok("and asks the competition, not just the event",
   asked.every((u) => u.includes("/competitions/")));
ok("a competition id of its own is honoured", await (async () => {
  asked = [];
  await fetchPlayByPlay("401671800", "999");
  return asked.every((u) => u.includes("/competitions/999/"));
})());

server.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
