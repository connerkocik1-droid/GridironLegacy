/**
 * The Moves screen writes its own advice, so the advice is what is tested —
 * and specifically the cases the handoff names as bugs already caught once: a
 * badge that renders on every row, a suggestion the data cannot satisfy, and
 * an insight tier that never fires on a good roster.
 */
import {
  balancer,
  countdown,
  draftOrder,
  fitChip,
  fitScore,
  nextWaiverRun,
  perGame,
  pickValue,
  rosterNeed,
  trending,
  verdict,
  type Held,
} from "../moves-story";

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

const p = (name: string, pos: string, points: number, games = 3): Held => ({ name, pos, points, games });

console.log("--- the waiver clock ---");
{
  const before = new Date("2026-09-10T06:30:00Z");
  eq("before the run it is today", nextWaiverRun(before).toISOString(), "2026-09-10T08:00:00.000Z");
  eq("and counts down to it", countdown(before), "1:30:00");

  const after = new Date("2026-09-10T09:00:00Z");
  eq("once it has run it is tomorrow", nextWaiverRun(after).toISOString(), "2026-09-11T08:00:00.000Z");
  eq("with most of a day on the clock", countdown(after), "23:00:00");

  // On the minute is not "already gone".
  eq("exactly on the hour rolls forward",
    nextWaiverRun(new Date("2026-09-10T08:00:00Z")).toISOString(), "2026-09-11T08:00:00.000Z");
}

console.log("\n--- what the league is chasing ---");
{
  const moves = [
    { kind: "add", player: "Chased" }, { kind: "drop", player: "Chased" },
    { kind: "add", player: "Chased" },
    { kind: "add", player: "Wanted" },
    { kind: "drop", player: "Shed" }, { kind: "drop", player: "Shed" },
  ];
  const rows = trending(moves);
  eq("busiest first", rows[0].name, "Chased");
  eq("counted both ways", rows[0].moves, 3);
  eq("with the net", rows[0].net, 1);
  eq("somebody only dropped is negative", rows.find((r) => r.name === "Shed")!.net, -2);
  eq("and the strip has a length", trending(moves, 2).length, 2);
  eq("nothing moved is nothing to show", trending([]), []);
}

console.log("\n--- the four tiers, so something always shows ---");
{
  const starters = { QB: 1, RB: 2, WR: 2, TE: 1 };

  // Tier 1: a slot with nobody in it.
  const short = [p("QB One", "QB", 60), p("RB One", "RB", 60), p("WR One", "WR", 60), p("WR Two", "WR", 50)];
  const hole = rosterNeed(short, [p("Back Two", "RB", 30)], starters);
  eq("an unfilled slot is the loudest thing", hole.tier, "hole");
  ok("it names the slot and the fit", /short at RB/.test(hole.text) && /Back Two/.test(hole.text));

  // Tier 1 with nothing to fix it: still says so rather than promising a name.
  const bare = rosterNeed(short, [], starters);
  eq("with nobody to fill it, it still says so", bare.tier, "hole");
  ok("and does not invent a fit", /pool is thin/.test(bare.text));

  // Tier 2: full roster, wire beats the weaker starter.
  const full = [
    p("QB One", "QB", 60), p("RB One", "RB", 90), p("RB Two", "RB", 30),
    p("WR One", "WR", 60), p("WR Two", "WR", 50), p("TE One", "TE", 40),
  ];
  const up = rosterNeed(full, [p("Hot Back", "RB", 75)], starters);
  eq("a wire player beating a starter is next", up.tier, "starter");
  ok("naming both sides", /Hot Back/.test(up.text) && /RB Two/.test(up.text));

  // Tier 3: the whole point of the ladder — a strong roster where nothing
  // beats a starter but something beats the worst man held.
  const strong = [...full, p("Spare", "TE", 3)];
  const bench = rosterNeed(strong, [p("Useful", "WR", 20)], starters);
  eq("otherwise it compares against the worst man held", bench.tier, "bench");
  ok("and names him", /Spare/.test(bench.text));

  // Tier 4: nothing at all, said out loud.
  const quiet = rosterNeed(strong, [p("Nobody", "WR", 1)], starters);
  eq("and when the wire has nothing it says that", quiet.tier, "none");
  ok("naming the weakest spot anyway", /Spare/.test(quiet.text));

  ok("every tier renders something", [hole, up, bench, quiet].every((n) => n.text.length > 20));
}

console.log("\n--- a chip that is not on every row ---");
{
  const starters = { QB: 1, RB: 2, WR: 2, TE: 1 };
  const mine = [
    p("QB One", "QB", 60), p("RB One", "RB", 90), p("RB Two", "RB", 30),
    p("WR One", "WR", 60), p("WR Two", "WR", 50), p("TE One", "TE", 12),
  ];

  eq("a man who fills an empty slot", fitChip(p("Kicker", "K", 30), mine, { ...starters, K: 1 })?.label, "FILLS K");
  eq("a man who beats a starter", fitChip(p("Hot", "RB", 75), mine, starters)?.label, "STARTER");
  eq("a man who beats the worst held", fitChip(p("Fine", "WR", 20), mine, starters)?.label, "OVER ONE");

  // The case that matters: most of the wire earns nothing.
  eq("and most of the wire earns no chip at all", fitChip(p("Nobody", "WR", 2), mine, starters), null);
  const wire = [p("A", "WR", 1), p("B", "WR", 2), p("C", "RB", 3), p("D", "TE", 2)];
  eq("so a quiet wire draws no chips",
    wire.filter((x) => fitChip(x, mine, starters)).length, 0);
}

console.log("\n--- who is worth trading with ---");
{
  const starters = { QB: 1, RB: 2, WR: 2 };
  const me = [p("QB", "QB", 10), p("RB", "RB", 10), p("WR1", "WR", 10), p("WR2", "WR", 10), p("WR3", "WR", 10)];
  const deepAtRb = [p("QB", "QB", 10), p("RB1", "RB", 10), p("RB2", "RB", 10), p("RB3", "RB", 10), p("WR", "WR", 10)];
  const mirror = [p("QB", "QB", 10), p("RB", "RB", 10), p("WR1", "WR", 10), p("WR2", "WR", 10), p("WR3", "WR", 10)];

  ok("short one way and deep the other is a fit", fitScore(me, deepAtRb, starters) > 0);
  // Both hold a surplus of the same thing and neither is short: nothing to do.
  eq("two identical rosters are not", fitScore(me, mirror, starters), 0);
}

console.log("\n--- picks are worth what the table says ---");
{
  ok("an earlier round is worth more", pickValue(1, 5) > pickValue(3, 5));
  ok("and an earlier slot in the same round", pickValue(2, 1) > pickValue(2, 10));
  eq("the draft runs weakest first",
    draftOrder([{ id: "a", points: 300 }, { id: "b", points: 100 }, { id: "c", points: 200 }]),
    ["b", "c", "a"]);
}

console.log("\n--- evening up an offer ---");
{
  const picks = [
    { id: "r1", label: "2027 1st", value: 40 },
    { id: "r4", label: "2027 4th", value: 12 },
    { id: "r5", label: "2027 5th", value: 6 },
  ];

  const close = balancer(11, picks, "Ana")!;
  eq("it reaches for the pick nearest the gap", close.id, "r4");
  eq("from the side that is ahead", close.side, "send");
  ok("and says how close it gets", /within 1\.0 points/.test(close.text));

  eq("the other way round it comes from them", balancer(-11, picks, "Ana")!.side, "get");

  // The trap the handoff names: a suggestion that does not close the gap.
  eq("a gap no single pick can close is not suggested", balancer(200, picks, "Ana"), null);
  eq("nor is an even deal sweetened", balancer(2, picks, "Ana"), null);
  eq("and with no picks to offer there is nothing to say", balancer(11, [], "Ana"), null);
}

console.log("\n--- and the verdict turns over ---");
{
  ok("an empty offer explains itself", /Pick players or picks/.test(verdict(0, false, "Ana")));
  ok("a close one is close", /As even as trades get/.test(verdict(2, true, "Ana")));
  ok("ahead names them", /Ana will want the gap closed/.test(verdict(20, true, "Ana")));
  ok("behind is honest about it", /You give up 20\.0/.test(verdict(-20, true, "Ana")));
}

console.log("\n--- and a man who has not played averages nothing ---");
eq("rather than dividing by nought", perGame({ name: "New", pos: "WR", points: 0, games: 0 }), 0);

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
