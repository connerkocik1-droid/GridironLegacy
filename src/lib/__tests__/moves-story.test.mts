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
  fills,
  isShort,
  replacementLevels,
  surplusOf,
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

console.log("\n--- and this is not superflex ---");
{
  // One quarterback and one defense start. So the wire is full of
  // quarterbacks who outscore every receiver on it and would never take the
  // field: a manager already holding one has nowhere to play a second.
  //
  // Rates are what makes this go wrong. Ordering the wire by rate puts a
  // quarterback at the top of every recommendation. What decides it is the
  // surplus over the man who would take his place — and the best free
  // quarterback in a one-quarterback league is nearly as good as the one you
  // hold, while the best free receiver is nobody at all.
  //
  // Every figure below is per game; the helper divides by three.
  const g = (perGame: number) => perGame * 3;
  const starters = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, "D/ST": 1, K: 1 };

  // Ten starters, and seven men who can fill the five back/receiver/tight
  // slots and the two flexes, so nothing is short and the surplus tiers are
  // what is actually being tested.
  const mine = [
    p("My QB", "QB", g(30)),
    p("Back One", "RB", g(20)), p("Back Two", "RB", g(16)), p("Back Three", "RB", g(12)),
    p("Wide One", "WR", g(18)), p("Wide Two", "WR", g(15)), p("Wide Three", "WR", g(11)),
    p("Tight One", "TE", g(12)),
    p("My Kicker", "K", g(9)),
    p("My Defense", "D/ST", g(12)),
  ];

  // The wire. The quarterbacks and the defenses outscore the receiver by a
  // distance and are each barely better than the next one of their own kind.
  const wire = [
    p("Free QB", "QB", g(26)), p("Other QB", "QB", g(25)),
    p("Free Defense", "D/ST", g(11)), p("Other Defense", "D/ST", g(10)),
    p("Free Wide", "WR", g(14)), p("Spare Wide", "WR", g(2)),
    p("Free Back", "RB", g(10)), p("Spare Back", "RB", g(3)),
    p("Free Tight", "TE", g(9)), p("Spare Tight", "TE", g(2)),
    p("Free Kicker", "K", g(8)), p("Spare Kicker", "K", g(7)),
  ];

  const levels = replacementLevels(wire);

  // 26 against a 25 replacement is one point of surplus. 14 against a wire
  // whose next receiver manages 2 is twelve.
  eq("a quarterback's surplus is only what is behind him",
    surplusOf(p("Free QB", "QB", g(26)), levels, false), 1);
  eq("a defense's likewise",
    surplusOf(p("Free Defense", "D/ST", g(11)), levels, false), 1);
  eq("and a receiver's is the empty wire behind him",
    surplusOf(p("Free Wide", "WR", g(14)), levels, false), 12);

  // The trap, named so a regression is recognisable: on rate alone the
  // quarterback beats the receiver by twelve a game.
  ok("on rate the quarterback wins by a distance",
    perGame(p("Free QB", "QB", g(26))) > perGame(p("Free Wide", "WR", g(14))));

  // The complaint, in one assertion.
  const advice = rosterNeed(mine, wire, starters);
  ok(`the wire advice names the receiver, not the quarterback (${advice.text})`,
    /Free Wide/.test(advice.text) && !/Free QB/.test(advice.text) &&
    !/Free Defense/.test(advice.text));
  eq("and it is the bench tier, since nothing beats a starter", advice.tier, "bench");

  // The row chips agree with it.
  eq("the receiver is chipped",
    fitChip(p("Free Wide", "WR", g(14)), mine, starters, levels)?.label, "OVER THREE");
  eq("the second quarterback is not",
    fitChip(p("Free QB", "QB", g(26)), mine, starters, levels), null);
  eq("nor the second defense",
    fitChip(p("Free Defense", "D/ST", g(11)), mine, starters, levels), null);

  // A man on a roster is measured against the best free agent at his position,
  // because that is who replaces him if he goes.
  eq("a rostered man is measured against his own replacement",
    surplusOf(p("My QB", "QB", g(30)), levels, true), 4);
  eq("and the weakest thing held is the one the wire can match",
    surplusOf(p("Wide Three", "WR", g(11)), levels, true), -3);

  // A genuine hole still outranks all of this: a manager with no defense
  // should be told to sign one, whatever the surplus arithmetic says.
  const noDefense = mine.filter((x) => x.pos !== "D/ST");
  const hole = rosterNeed(noDefense, wire, starters);
  eq("an empty slot is still the loudest thing", hole.tier, "hole");
  ok(`and it names a defense to fill it (${hole.text})`, /Free Defense/.test(hole.text));
}

console.log("\n--- a flex is a slot, not a position ---");
{
  // Nobody's position is "FLEX", so counting held flexes the way a dedicated
  // slot is counted found nought every time. Every roster in every league that
  // fields a flex — which is every league — was permanently told it was short
  // at FLEX, and offered the best man on the wire to fix a hole it did not
  // have.
  const starters = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, "D/ST": 1, K: 1 };
  const g = (perGame: number) => perGame * 3;

  // Five backs, receivers and tight ends between them: two short of the seven
  // this league fields.
  const thin = [
    p("My QB", "QB", g(30)),
    p("Back One", "RB", g(20)), p("Back Two", "RB", g(16)),
    p("Wide One", "WR", g(18)), p("Wide Two", "WR", g(15)),
    p("Tight One", "TE", g(12)),
    p("My Kicker", "K", g(9)), p("My Defense", "D/ST", g(12)),
  ];
  ok("a roster two bodies short of its flexes is short at flex",
    isShort("FLEX", thin, starters));

  const full = [...thin, p("Back Three", "RB", g(10)), p("Wide Three", "WR", g(9))];
  ok("and one that fills them is not", !isShort("FLEX", full, starters));
  ok("no dedicated slot is short either",
    !isShort("QB", full, starters) && !isShort("WR", full, starters));

  // Which is the whole point: a full roster gets advice about upgrades rather
  // than a permanent hole nobody can fill.
  const wire = [p("Free Wide", "WR", g(14)), p("Spare Wide", "WR", g(2))];
  ok("so a full roster is not told it is short",
    rosterNeed(full, wire, starters).tier !== "hole");
  eq("while a thin one is", rosterNeed(thin, wire, starters).tier, "hole");

  // A quarterback cannot fill a flex. That is what "not superflex" means, and
  // it is the one thing the slot rule must not get wrong.
  ok("a back, a receiver and a tight end can flex",
    fills("RB", "FLEX") && fills("WR", "FLEX") && fills("TE", "FLEX"));
  ok("a quarterback cannot", !fills("QB", "FLEX"));
  ok("and neither can a kicker or a defense",
    !fills("K", "FLEX") && !fills("D/ST", "FLEX"));

  // The chip says which slot he is filling rather than claiming his own.
  eq("a receiver filling a flex says so",
    fitChip(p("Free Wide", "WR", g(14)), thin, starters, replacementLevels(wire))?.label,
    "FILLS FLEX");
  eq("but a receiver whose own slot is empty says that instead",
    fitChip(p("Free Wide", "WR", g(14)),
      thin.filter((x) => x.pos !== "WR"), starters, replacementLevels(wire))?.label,
    "FILLS WR");
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
