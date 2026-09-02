/**
 * The commissioner's scoring check.
 *
 * The page it feeds exists to be trusted by somebody reading it rather than
 * the code, so the property that matters most is checked here on every single
 * player: the breakdown shown must add up to the score shown. A page that
 * displays working which does not reconcile is worse than one that shows no
 * working at all — it looks like proof.
 */

import { createServer, type Server } from "node:http";
import { PRESEASON_SCOREBOARD, SCOREBOARD, SUMMARY } from "./fixtures/espn-game.mts";

let failed = 0;

const ok = (label: string, got: boolean) => {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  if (!got) failed++;
};
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}`}`);
  if (!pass) failed++;
};
const near = (label: string, got: number, want: number) => {
  const pass = Math.abs(got - want) < 1e-6;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}: got ${got}, want ${want}`);
  if (!pass) failed++;
};

let asked: string[] = [];

function serve(): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = req.url ?? "";
      asked.push(url);

      // The preseason board is only handed back when the preseason is what was
      // asked for, so a route that forgets to ask gets caught rather than
      // quietly scoring the regular season. And only for week 3, so asking for
      // a week nobody has played gets an empty board, as it would in August.
      const body = url.startsWith("/summary")
        ? SUMMARY
        : url.includes("seasontype=1")
          ? url.includes("week=3")
            ? PRESEASON_SCOREBOARD
            : { events: [] }
          : SCOREBOARD;

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
process.env.ESPN_API_BASE = base;

const { preseasonWeek } = await import("../preseason.ts");

const LEAGUE = {
  starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, "D/ST": 1, K: 1 },
  bench: 14,
  ir: 2,
};

console.log("--- a preseason week, scored ---");

asked = [];
const week = await preseasonWeek(3, "half", LEAGUE);

ok("it asked ESPN for the preseason", asked.some((u) => u.includes("seasontype=1")));
ok("and never for the regular season", !asked.some((u) => u.includes("seasontype=2")));
eq("the week it was asked for", week.week, 3);
ok("something was found", week.found);
eq("no game failed to load", week.failed, []);

// THE invariant. Every number this page shows must reconcile with the working
// printed underneath it.
const mismatched = week.players.filter((p) => {
  const sum = p.terms.reduce((t, term) => t + term.points, 0);
  return Math.abs(Math.round(sum * 100) / 100 - p.points) > 1e-9;
});
eq("every breakdown adds up to the score beside it", mismatched.map((p) => p.name), []);

ok("and there were players to check", week.players.length >= 8);

const by = (name: string) => week.players.find((p) => p.name.includes(name));

console.log("\n--- the same arithmetic as a real week ---");

// Identical to the values asserted in live-scoring.test.mts, which is the
// point: one engine, so a preseason check is a check of the real thing.
near("Mahomes", by("Mahomes")!.points, 16);
near("Kelce", by("Kelce")!.points, 20.5);
near("Butker, two from fifty-plus", by("Butker")!.points, 13);
near("Cook, who lost one", by("Cook")!.points, 17.5);
near("Kansas City's defence", by("Kansas City")!.points, 10);
near("Buffalo's, with the safety", by("Buffalo")!.points, 5);

console.log("\n--- positions ---");

// ESPN says PK for a kicker; the roster slot is K. Getting this wrong leaves
// the slot empty and looks like "nobody kicked".
eq("a kicker is a K, not a PK", by("Butker")!.position, "K");
eq("read from ESPN", by("Butker")!.positionSource, "espn");
eq("a tight end is a tight end", by("Kelce")!.position, "TE");

// Josh Allen carries no position in the fixture, so the pool answers for him.
const allen = by("Josh Allen")!;
ok("a player ESPN did not label still gets a position", allen.position !== "");
ok("and the page says where it came from", allen.positionSource !== "espn");

console.log("\n--- who is picked, and why ---");

// Busiest first, not highest-scoring: the whole point is a stat line with
// enough in it to be worth checking by hand.
const ranked = week.players.filter((p) => p.workload > 0);
ok(
  "the list is ordered by workload",
  ranked.every((p, i) => i === 0 || ranked[i - 1].workload >= p.workload),
);

// Cook: 18 carries plus 3 targets. Allen: 35 attempts plus 8 carries.
near("carries and targets are counted", by("Cook")!.workload, 21);
near("attempts and carries too", by("Josh Allen")!.workload, 43);

const slots = week.lineup.map((r) => r.slot);
eq("the lineup is in the league's own slot order", slots, [
  "QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "D/ST", "K",
]);

const qb = week.lineup.find((r) => r.slot === "QB")!.player;
eq("the busiest quarterback starts", qb?.name, "Josh Allen");

const kicker = week.lineup.find((r) => r.slot === "K")!.player;
eq("the K slot is filled", kicker?.name, "Harrison Butker");

const dst = week.lineup.find((r) => r.slot === "D/ST")!.player;
ok("and so is the defence", (dst?.name ?? "").includes("D/ST"));

// Nobody is started twice, which a naive fill would do across FLEX.
const started = week.lineup.map((r) => r.player?.name).filter(Boolean);
eq("nobody is started in two slots", started.length, new Set(started).size);

near(
  "the total is the lineup's, not the whole slate's",
  week.total,
  Math.round(
    week.lineup.reduce((sum, r) => sum + (r.player?.points ?? 0), 0) * 100,
  ) / 100,
);

console.log("\n--- the stat line beside the score ---");

// The same function the lineup and the matchup use, so what is checked here
// is what a manager will read there.
eq(
  "a quarterback: comp/att, yards, and only the touchdowns he threw",
  by("Mahomes")!.statLine,
  "25/38 · 300 pass yds · 1 pass TD · 1 INT",
);
ok(
  "with no rushing line, because he did not run",
  !by("Mahomes")!.statLine.includes("rush"),
);

eq(
  "a dual-threat quarterback shows both",
  by("Josh Allen")!.statLine,
  "22/35 · 250 pass yds · 40 rush yds · 1 pass TD · 1 rush TD · 2 INT",
);

eq(
  "a back: carries, both kinds of yards, and the fumble he lost",
  by("Cook")!.statLine,
  "18 car · 100 rush yds · 20 rec yds · 1 rec TD · 1 fum lost",
);

eq(
  "a tight end: targets, catches, yards, score",
  by("Kelce")!.statLine,
  "9 tgt · 7 rec · 90 rec yds · 1 rec TD",
);

eq("a kicker: made over attempted", by("Butker")!.statLine, "3/4 FG · 1/1 XP");

// Yards allowed comes from ESPN's team-total row, which is the only place the
// figure exists — no per-player line adds up to it.
const kc = by("Kansas City")!;
ok("a defence names what it gave up", /yds allowed/.test(kc.statLine));
eq("read from the team totals", kc.line.yardsAllowed, 388);
ok("and the sacks, recoveries and takeaways", /3 sack · 1 FR · 2 INT/.test(kc.statLine));

console.log("\n--- what it shows its working with ---");

const mahomes = by("Mahomes")!;
ok("the raw ESPN columns are kept", mahomes.raw.length > 0);
ok(
  "including the ones no rule touches",
  mahomes.raw.some((g) => Object.keys(g.stats).includes("AVG")),
);
ok("each term names the rule applied", mahomes.terms.every((t) => t.rule !== ""));
ok("and the game it came from, for the box-score link", mahomes.gameId !== "");

// A man who neither touched the ball nor scored belongs to his unit's score,
// not to a row of his own.
ok("a tackler with no touches is not listed", !week.players.some((p) => p.name === "Nick Bolton"));

console.log("\n--- a week that has not been played ---");

const none = await preseasonWeek(1, "half", LEAGUE);
ok("week 1 of this fixture has no played games", !none.players.length);
eq("and says so rather than erroring", none.lineup, []);

server.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
