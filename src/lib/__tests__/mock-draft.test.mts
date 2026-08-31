import { POOL, type Player, type Position } from "../../data/league-data";
import {
  blocked,
  byePenalty,
  chooseFor,
  effectiveAdp,
  needBonus,
  rngFrom,
  snakeOrder,
} from "../mock-draft";

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
  bench: 6,
};
const ROUNDS = 15;

const at = (round: number, roster: Player[] = []) => ({
  roster,
  round,
  rounds: ROUNDS,
  league: LEAGUE,
});

/** A stand-in player, so a test can say exactly what it is testing. */
const man = (p: Position, adp: number, bye = 0, n = `${p}-${adp}-${bye}`): Player =>
  ({ n, p, t: "BUF", adp, bye, arch: "", q: false }) as Player;

console.log("");
console.log("--- ADP is the spine ---");

{
  // Nothing on the roster, nothing to argue with: the board's order stands.
  const board = [man("RB", 12), man("WR", 4), man("TE", 30)];
  const pick = chooseFor(board, at(1), rngFrom(1));
  eq("an empty roster takes the best player available", pick?.p, "WR");
}

{
  // Two of the same position, neither clashing on a bye: nothing is left to
  // separate them but the board, and the board decides.
  const roster = [man("QB", 10), man("RB", 20), man("RB", 30), man("WR", 40)];
  const ctx = at(6, roster);
  ok(
    "between two of a kind, the better ADP scores better",
    effectiveAdp(man("WR", 55, 5), ctx) < effectiveAdp(man("WR", 70, 9), ctx),
  );
  eq("and neither is carrying a bye penalty", byePenalty(man("WR", 55, 5), ctx), 0);
}

console.log("");
console.log("--- position need ---");

{
  const noQb = at(9);
  const oneQb = at(9, [man("QB", 30)]);
  ok(
    "a team without its starting quarterback reaches for one",
    needBonus("QB", noQb) > 0,
  );
  ok(
    "and stops reaching once it has one",
    needBonus("QB", oneQb) < needBonus("QB", noQb),
  );
}

{
  const early = needBonus("TE", at(3));
  const late = needBonus("TE", at(13));
  ok("the reach grows as the rounds run out", late > early);
}

{
  // Two quarterbacks is the most anyone carries; a third never comes up.
  const two = at(12, [man("QB", 20), man("QB", 60)]);
  ok("a third quarterback is not considered at all", blocked("QB", two));
}

{
  const stacked = at(12, [man("RB", 5), man("RB", 15), man("RB", 25), man("RB", 35)]);
  ok(
    "a roster deep at a position slides the next one down the board",
    needBonus("RB", stacked) < 0,
  );
}

{
  // The whole point of need: a worse player at a position you must fill is
  // worth more than a better one at a position you have covered. Measured on
  // the score itself, so the late-round jitter is not what is being tested.
  const roster = [man("RB", 5), man("RB", 15), man("WR", 25), man("WR", 35), man("TE", 45)];
  const ctx = at(13, roster);
  ok(
    "a needed starter outranks a better player already covered",
    effectiveAdp(man("QB", 62), ctx) < effectiveAdp(man("RB", 50), ctx),
  );
}

{
  // And through the whole decision. Late rounds carry real disagreement on
  // purpose — a mock where every team drafts the same way is not practice —
  // so this asks how often, not whether.
  const roster = [man("RB", 5), man("RB", 15), man("WR", 25), man("WR", 35), man("TE", 45)];
  const board = [man("RB", 48), man("QB", 52)];
  const takes = Array.from({ length: 200 }, (_, seed) =>
    chooseFor(board, at(14, roster), rngFrom(seed + 1))?.p,
  );
  const quarterbacks = takes.filter((p) => p === "QB").length;
  ok(
    `and the pick usually goes that way (${quarterbacks} times in 200)`,
    quarterbacks > 140,
  );
}

{
  // Four running backs and nothing else does not leave a flex slot open for a
  // fifth: the receiver places are empty, and a running back cannot fill one.
  const fourRb = at(10, [man("RB", 5), man("RB", 15), man("RB", 25), man("RB", 35)]);
  ok("a fifth running back gets no credit for the flex", needBonus("RB", fourRb) <= 0);
  ok("while the receivers are still worth reaching for", needBonus("WR", fourRb) > 0);
}

console.log("");
console.log("--- bye weeks ---");

{
  const clear = at(6, [man("RB", 5, 7), man("WR", 15, 9)]);
  eq("two players on different byes is nothing to answer for", byePenalty(man("TE", 40, 11), clear), 0);
  eq("and a second on the same bye is a normal week off", byePenalty(man("TE", 40, 7), clear), 0);
}

{
  const two = at(6, [man("RB", 5, 7), man("WR", 15, 7)]);
  const three = at(6, [man("RB", 5, 7), man("WR", 15, 7), man("TE", 25, 7)]);
  ok("a third on one bye costs something", byePenalty(man("WR", 40, 7), two) > 0);
  ok(
    "and a fourth costs more than the third",
    byePenalty(man("WR", 40, 7), three) > byePenalty(man("WR", 40, 7), two),
  );
}

{
  // Same position, same need, one ADP apart — the bye is the only thing left
  // to decide it.
  const roster = [man("WR", 5, 7), man("WR", 15, 7), man("RB", 25, 7)];
  const board = [man("WR", 40, 7), man("WR", 41, 12)];
  const pick = chooseFor(board, at(8, roster), rngFrom(3));
  eq("between equals, the clear bye week wins", pick?.bye, 12);
}

{
  const kickers = at(6, [man("K", 5, 7), man("D/ST", 15, 7)]);
  eq(
    "kickers and defences are exempt — those get streamed",
    byePenalty(man("K", 40, 7), kickers),
    0,
  );
}

console.log("");
console.log("--- when kickers and defences go ---");

{
  ok("not in the eighth round", blocked("K", at(8)));
  ok("nor a defence", blocked("D/ST", at(8)));
  ok("but in the second to last, yes", blocked("K", at(ROUNDS - 1)), false);
  ok("and the last", blocked("D/ST", at(ROUNDS)), false);
}

{
  // A kicker at the top of the board in round eight must not be taken.
  const board = [man("K", 1), man("WR", 90)];
  const pick = chooseFor(board, at(8), rngFrom(11));
  eq("a cheap kicker early is passed over", pick?.p, "WR");
}

{
  // The bug this exists to stop: defences live around ADP 240, far below any
  // sensible window on the board, so a team that only reads down the list
  // finishes the draft without one — not by choosing against it, but by never
  // having seen one.
  const roster = [
    man("QB", 10), man("RB", 20), man("RB", 30), man("WR", 40),
    man("WR", 50), man("TE", 60), man("RB", 70), man("WR", 80), man("K", 150),
  ];
  const board = [
    ...Array.from({ length: 40 }, (_, i) => man("WR", 160 + i)),
    man("D/ST", 240),
  ];
  const pick = chooseFor(board, at(ROUNDS, roster), rngFrom(5));
  eq("a defence far down the board is still found when one is needed", pick?.p, "D/ST");
}

{
  // And once every remaining pick has a job, value stops being the question.
  const roster = [man("RB", 5), man("RB", 15), man("WR", 25), man("WR", 35), man("TE", 45)];
  const ctx = at(ROUNDS - 2, roster); // three picks left, three starters missing
  ok(
    "with as many holes as picks left, filling one beats everything",
    effectiveAdp(man("QB", 200), ctx) < effectiveAdp(man("WR", 1), ctx),
  );
}

console.log("");
console.log("--- the snake ---");

{
  const order = snakeOrder(3, 4);
  eq("round one runs forward", order.slice(0, 3), [0, 1, 2]);
  eq("round two runs back", order.slice(3, 6), [2, 1, 0]);
  eq("round three forward again", order.slice(6, 9), [0, 1, 2]);
  eq("and every seat picks once a round", order.length, 12);
}

console.log("");
console.log("--- against the real pool ---");

{
  // A whole mock, drafted by the AI on every seat, checked for the things a
  // human would notice were wrong.
  const rng = rngFrom(20260831);
  const teams = 12;
  const rounds = 15;
  const rosters: Player[][] = Array.from({ length: teams }, () => []);
  const taken = new Set<string>();
  let available = POOL.filter((p) => p.adp > 0).sort((a, b) => a.adp - b.adp);

  for (const seat of snakeOrder(teams, rounds)) {
    const round = Math.floor(taken.size / teams) + 1;
    const pick = chooseFor(
      available.filter((p) => !taken.has(p.n)),
      { roster: rosters[seat], round, rounds, league: LEAGUE },
      rng,
    );
    if (!pick) break;
    taken.add(pick.n);
    rosters[seat].push(pick);
  }
  available = available.filter((p) => !taken.has(p.n));

  eq("every seat fills every round", rosters.map((r) => r.length), Array(teams).fill(rounds));
  eq("nobody is drafted twice", taken.size, teams * rounds);

  const count = (r: Player[], p: Position) => r.filter((x) => x.p === p).length;

  ok(
    "every team comes out with a quarterback",
    rosters.every((r) => count(r, "QB") >= 1),
  );
  ok(
    "and a tight end",
    rosters.every((r) => count(r, "TE") >= 1),
  );
  ok(
    "and the two running backs it starts",
    rosters.every((r) => count(r, "RB") >= 2),
  );
  ok(
    "nobody carries three quarterbacks",
    rosters.every((r) => count(r, "QB") <= 2),
  );
  ok(
    "nor two kickers",
    rosters.every((r) => count(r, "K") <= 1),
  );
  ok(
    "every team ends with a kicker",
    rosters.every((r) => count(r, "K") === 1),
  );
  ok(
    "and a defence",
    rosters.every((r) => count(r, "D/ST") === 1),
  );
  ok(
    "so every team can field a legal lineup",
    rosters.every(
      (r) =>
        count(r, "QB") >= 1 && count(r, "RB") >= 2 && count(r, "WR") >= 2 &&
        count(r, "TE") >= 1 && count(r, "K") === 1 && count(r, "D/ST") === 1,
    ),
  );

  const kickerRounds = rosters.flatMap((r) =>
    r.map((p, i) => (p.p === "K" || p.p === "D/ST" ? i + 1 : 0)).filter(Boolean),
  );
  ok(
    "kickers and defences all went in the last two rounds",
    kickerRounds.every((r) => r > rounds - 2),
  );

  const worstBye = Math.max(
    ...rosters.map((r) => {
      const byes: Record<number, number> = {};
      for (const p of r) if (p.bye && p.p !== "K" && p.p !== "D/ST") byes[p.bye] = (byes[p.bye] ?? 0) + 1;
      return Math.max(0, ...Object.values(byes));
    }),
  );
  ok(`no roster is buried on one bye week (worst was ${worstBye})`, worstBye <= 5);

  // The first round should still look like the first round.
  const firstRound = rosters.map((r) => r[0].adp);
  ok(
    "round one stays near the top of the board",
    Math.max(...firstRound) <= 24,
  );

  // Two different seeds must not produce the same draft.
  const other = rngFrom(99);
  const otherRoster: Player[] = [];
  const otherTaken = new Set<string>();
  for (let round = 1; round <= 5; round++) {
    const pick = chooseFor(
      POOL.filter((p) => p.adp > 0 && !otherTaken.has(p.n)),
      { roster: otherRoster, round, rounds, league: LEAGUE },
      other,
    );
    if (pick) {
      otherTaken.add(pick.n);
      otherRoster.push(pick);
    }
  }
  ok(
    "a different seed drafts a different team",
    JSON.stringify(otherRoster.map((p) => p.n)) !==
      JSON.stringify(rosters[0].slice(0, 5).map((p) => p.n)),
  );
}

console.log("");
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
