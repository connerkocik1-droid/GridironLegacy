/**
 * Best ball: the lineup nobody sets.
 *
 * Two things are being checked here, and the second matters more than it
 * looks. The first is the arrangement itself — that the highest scorers fill
 * the slots, that the flex takes what is left over, that a man who has not
 * played is worth nought rather than his projection. The second is that the
 * browser and the database agree about all of it: migration 0036 grades the
 * week in SQL, this code draws the same week on a screen, and a league where
 * those two disagree is a league where the page lies to you all afternoon and
 * then the result comes out different.
 *
 * So the ordering rule tested below — points descending, ties broken on name —
 * is written twice on purpose, once here and once in best_ball_lineup, and
 * these tests are what holds the two together.
 */

import { slotAccepts, startingSlots } from "../lineup";
import { bestLineup, frozenLineup, pairLineups, totalOf, type Score } from "../matchup";

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

const LEAGUE = {
  starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, "D/ST": 1, K: 1 },
  bench: 14,
  ir: 2,
};

// A smaller league, so a flex has one seat and the arithmetic is readable.
const SMALL = {
  starters: { QB: 1, RB: 1, WR: 1, TE: 1, FLEX: 1, "D/ST": 1, K: 1 },
  bench: 6,
  ir: 1,
};

// Real players, so positions resolve through the actual pool.
const QB = "Jayden Daniels";
const RB1 = "Jahmyr Gibbs";
const RB2 = "Bijan Robinson";
const RB3 = "James Cook III";
const WR1 = "Ja'Marr Chase";
const WR2 = "Puka Nacua";
const TE = "Brock Bowers";
const K = "Brandon Aubrey";
const DST = "Seattle Seahawks D/ST";

const scored = (points: Record<string, number>): Map<string, Score> =>
  new Map(Object.entries(points).map(([name, p]) => [name, { points: p, statLine: "" }]));

/** Who is in which slot, as a flat list, for comparing whole arrangements. */
const arrangement = (rows: { slot: string; entry: { name: string } | null }[]) =>
  rows.map((r) => `${r.slot}:${r.entry?.name ?? "—"}`);

console.log("--- slot eligibility ---");
ok("QB slot takes a QB", slotAccepts("QB", "QB", LEAGUE));
ok("QB slot rejects an RB", slotAccepts("QB", "RB", LEAGUE), false);
ok("FLEX takes an RB", slotAccepts("FLEX", "RB", LEAGUE));
ok("FLEX takes a WR", slotAccepts("FLEX", "WR", LEAGUE));
ok("FLEX takes a TE", slotAccepts("FLEX", "TE", LEAGUE));
ok("FLEX rejects a QB", slotAccepts("FLEX", "QB", LEAGUE), false);
ok("FLEX rejects a kicker", slotAccepts("FLEX", "K", LEAGUE), false);
ok("BENCH takes anyone", slotAccepts("BENCH", "K", LEAGUE));
ok("IR takes anyone", slotAccepts("IR", "D/ST", LEAGUE));

const NO_TE = { starters: { QB: 1, RB: 2, WR: 3, FLEX: 1, "D/ST": 1, K: 1 }, bench: 14 };
ok("FLEX rejects a TE where the league starts none", slotAccepts("FLEX", "TE", NO_TE), false);

console.log("\n--- the league's shape ---");
eq("slots come out in league order", startingSlots(LEAGUE), [
  "QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "D/ST", "K",
]);
ok("the flex always comes after the slots it competes with",
  startingSlots(LEAGUE).lastIndexOf("WR") < startingSlots(LEAGUE).indexOf("FLEX"));

console.log("\n--- the highest scorers fill the slots ---");

const roster = [QB, RB1, RB2, RB3, WR1, WR2, TE, K, DST];

// Deliberately upside down: the man with the worst projection has the best
// afternoon, which is the whole case for best ball.
const sunday = scored({
  [QB]: 22.4,
  [RB1]: 4.1,
  [RB2]: 9.8,
  [RB3]: 31.2,
  [WR1]: 12.0,
  [WR2]: 6.5,
  [TE]: 15.1,
  [K]: 8.0,
  [DST]: 11.0,
});

const live = bestLineup(roster, SMALL, sunday, "points");

eq("each slot takes the best at its position, and the flex the best left over",
  arrangement(live), [
    `QB:${QB}`,
    `RB:${RB3}`,
    `WR:${WR1}`,
    `TE:${TE}`,
    `FLEX:${RB2}`,
    `D/ST:${DST}`,
    `K:${K}`,
  ]);

ok("nobody is in two slots at once",
  new Set(live.map((r) => r.entry?.name)).size === live.length);

eq("and the week is worth the sum of them",
  Math.round(live.reduce((sum, r) => sum + (r.entry?.points ?? 0), 0) * 10) / 10,
  Math.round((22.4 + 31.2 + 12.0 + 15.1 + 9.8 + 11.0 + 8.0) * 10) / 10);

// The point of the whole feature: the best afternoon on the roster is in the
// lineup, whatever anybody would have guessed on Saturday.
ok("the roster's best score is never left out",
  live.some((r) => r.entry?.name === RB3));

console.log("\n--- a man who has not played is worth nought ---");

// Only one game has kicked off. The rest are worth nothing yet, not their
// projections — a live total that counts points nobody has scored is a total
// that falls as the afternoon goes on.
const early = bestLineup(roster, SMALL, scored({ [RB1]: 3.0 }), "points");
const rb = early.find((r) => r.slot === "RB");

eq("the one man who has scored takes his slot", rb?.entry?.name, RB1);
eq("and the total is what has actually been scored", totalOf(
  [{ slot: "RB", home: rb?.entry ?? null, away: null }], "home"), 3);

const unplayed = early.find((r) => r.slot === "QB");
eq("an unplayed starter counts nought", unplayed?.entry?.points, 0);
ok("but his projection is still there to show", (unplayed?.entry?.projected ?? 0) > 0);
ok("and he is marked as not having played", unplayed?.entry?.live === false);

console.log("\n--- before anybody has kicked off ---");

// Nothing has been scored, so ordering by scores would be ordering by nothing.
// The projection stands in, and the page says so.
const preview = bestLineup(roster, SMALL, new Map(), "projection");
ok("every slot is filled from the roster", preview.every((r) => r.entry != null));
ok("and each is shown at his projection",
  preview.every((r) => r.entry!.points === r.entry!.projected));

console.log("\n--- ties break the way the database breaks them ---");

// best_ball_lineup orders by points desc, then name. Two players level is the
// normal state of a Sunday morning, and a lineup that reshuffles itself
// between two refreshes for no reason looks broken.
const levelWr = bestLineup([WR1, WR2, QB, K, DST, TE, RB1], SMALL, scored({
  [WR1]: 9, [WR2]: 9, [RB1]: 1,
}), "points");

const wrSlot = levelWr.find((r) => r.slot === "WR")!;
eq("the earlier name takes the slot", wrSlot.entry?.name, [WR1, WR2].sort()[0]);

const again = bestLineup([WR2, WR1, QB, K, DST, TE, RB1], SMALL, scored({
  [WR1]: 9, [WR2]: 9, [RB1]: 1,
}), "points");
eq("and the order the roster arrived in changes nothing",
  arrangement(levelWr), arrangement(again));

console.log("\n--- a roster with a hole in it ---");

// Nobody at tight end. In a league where lineups were set this was a warning
// somebody had to act on; here it is just an empty slot worth nothing, which
// is what it always was.
const thin = bestLineup([QB, RB1, WR1, K, DST], SMALL, scored({ [QB]: 10 }), "points");
eq("the slot nobody can fill is empty", thin.find((r) => r.slot === "TE")?.entry, null);
// QB, RB, WR, D/ST and K all have somebody; the flex has nobody left to take
// once the two skill slots are filled from five players.
eq("and the rest are still filled", thin.filter((r) => r.entry != null).length, 5);

console.log("\n--- two sides, paired ---");

const rows = pairLineups(
  [QB, RB1, WR1, TE, K, DST, RB2].map((player_name) => ({ player_name })),
  [RB3, WR2].map((player_name) => ({ player_name })),
  SMALL,
  sunday,
  "points",
);

eq("every slot is one row", rows.length, startingSlots(SMALL).length);
ok("a side with nobody at a position shows an empty half",
  rows.some((r) => r.home != null && r.away == null));
eq("and each side totals only its own", totalOf(rows, "away"), 31.2 + 6.5);

console.log("\n--- a settled week is read back, not worked out again ---");

// grade_week photographs the arrangement when the last game ends. Recomputing
// it later from today's rosters would quietly rewrite September every time
// somebody made a trade in November.
const snapshot = [
  { name: QB, slot: "QB", points: 30 },
  { name: RB1, slot: "RB", points: 20 },
  { name: WR1, slot: "FLEX", points: 10 },
];

const frozen = frozenLineup(snapshot, SMALL, scored({ [QB]: 4, [RB1]: 4, [WR1]: 4 }));

eq("the slots are the ones that were recorded",
  arrangement(frozen).filter((s) => !s.endsWith("—")),
  [`QB:${QB}`, `RB:${RB1}`, `FLEX:${WR1}`]);
eq("with the points that were recorded, not today's",
  frozen.flatMap((r) => (r.entry ? [r.entry.points] : [])), [30, 20, 10]);
eq("and the week is still worth what it was worth",
  totalOf(frozen.map((r) => ({ slot: r.slot, home: r.entry, away: null })), "home"), 60);

// A settled week whose snapshot is empty — a week graded before this existed —
// falls back to working it out, rather than showing a team of nobody.
const noSnapshot = pairLineups(
  roster.map((player_name) => ({ player_name })),
  [],
  SMALL,
  sunday,
  "points",
  { home: [], away: [] },
);
ok("an empty snapshot falls back to the live arrangement",
  noSnapshot.some((r) => r.home?.name === RB3));

console.log("\n--- nothing claims a lineup can be set ---");

// The feature is gone, and a leftover control or a leftover sentence is worse
// than either: it invites somebody to look for something that is not there.
const { readdirSync, readFileSync, statSync } = await import("node:fs");
const { join } = await import("node:path");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry) && !path.includes("__tests__") ? [path] : [];
  });
}

const sources = sourceFiles("src");

const settable = sources.filter((f) => /set your (starters|lineup)/i.test(readFileSync(f, "utf8")));
eq("nothing tells a manager to set their lineup", settable, []);

const benched = sources.filter((f) => /your bench|on the bench/i.test(readFileSync(f, "utf8")));
eq("and nothing calls half the roster a bench", benched, []);

// --- this is not a superflex league ----------------------------------------
//
// The app advertised itself as SUPERFLEX in three places while a flex slot
// only ever accepted a running back, receiver or tight end. The branding was
// what was wrong, and it was wrong on the first screen anybody saw. It matters
// more under best ball than it did before: the greedy fill above is only
// provably correct because the flex is the single shared slot.

console.log("\n--- the flex slot ---");

ok("a flex takes a running back", slotAccepts("FLEX", "RB"));
ok("a receiver", slotAccepts("FLEX", "WR"));
ok("and a tight end", slotAccepts("FLEX", "TE"));
ok("but not a quarterback — that would be a superflex", !slotAccepts("FLEX", "QB"));
ok("nor a kicker", !slotAccepts("FLEX", "K"));
ok("nor a defence", !slotAccepts("FLEX", "D/ST"));

const claiming = sources.filter((f) => /superflex/i.test(readFileSync(f, "utf8")));
eq("and nothing in the app says it is one", claiming, []);

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
