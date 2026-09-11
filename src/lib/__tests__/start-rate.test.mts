import { optimalLineup, startRates } from "../start-rate";

/**
 * How often a player actually starts.
 *
 * Best ball fills the slots by itself, so "starter" and "bench" are outcomes
 * rather than categories — and a projection does not answer the question that
 * decides whether a player is worth holding, which is whether he beats the
 * other four receivers on the same roster.
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

const LEAGUE = { starters: { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, K: 1, "D/ST": 1 }, bench: 8, ir: 2 };

console.log("--- a full roster ---");
{
  // Positions come from the pool, so this test uses real players: the lineup
  // filler asks what somebody plays and a made-up name plays nothing.
  const { POOL } = await import("../../data/league-data");
  const pick = (position: string, n: number) =>
    POOL.filter((p) => p.p === position).slice(0, n).map((p) => p.n);

  const names = [
    ...pick("QB", 2), ...pick("RB", 5), ...pick("WR", 5),
    ...pick("TE", 2), ...pick("K", 1), ...pick("D/ST", 1),
  ];

  const rates = startRates(names, LEAGUE);
  ok("everybody gets a rate", names.every((n) => rates.has(n)));
  ok("and every rate is a share", [...rates.values()].every((r) => r >= 0 && r <= 1));

  // A league fielding one quarterback, on a roster holding two: the better of
  // them cannot start every week, and the worse cannot start none.
  const [qb1, qb2] = pick("QB", 2);
  ok(`the better quarterback starts most weeks (${(rates.get(qb1)! * 100).toFixed(0)}%)`,
    rates.get(qb1)! > 0.5);
  ok(`and the other one still starts some (${(rates.get(qb2)! * 100).toFixed(0)}%)`,
    rates.get(qb2)! > 0.02 && rates.get(qb2)! < 0.5);

  // The one thing a ranking of projections could not tell you.
  ok("which is the whole point: it is not just an ordering",
    rates.get(qb1)! < 1 && rates.get(qb2)! > 0);

  // The only kicker on the roster, in a league that fields one.
  const [k] = pick("K", 1);
  eq("a player with nobody to beat starts every week", rates.get(k), 1);
}

console.log("\n--- and it is steady ---");
{
  const { POOL } = await import("../../data/league-data");
  const names = POOL.filter((p) => p.p === "RB").slice(0, 6).map((p) => p.n);
  const a = startRates(names, LEAGUE);
  const b = startRates(names, LEAGUE);
  eq("the same roster gives the same rates twice", [...a.values()], [...b.values()]);

  // A number that moves when nothing moved reads as a bug even when it is
  // only arithmetic.
  const shuffled = [...names].reverse();
  const c = startRates(shuffled, LEAGUE);
  ok("and the order they are listed in does not change them",
    names.every((n) => Math.abs((a.get(n) ?? 0) - (c.get(n) ?? 0)) < 0.12));
}

console.log("\n--- nothing at all ---");
{
  eq("an empty roster has no rates", [...startRates([], LEAGUE).keys()], []);
  const { POOL } = await import("../../data/league-data");
  const one = POOL.find((p) => p.p === "QB")!.n;
  ok("a roster of one still answers", startRates([one], LEAGUE).get(one)! > 0);
}

console.log("\n--- the lineup the chips mark ---");
{
  const { POOL } = await import("../../data/league-data");
  const pick = (position: string, n: number) =>
    POOL.filter((p) => p.p === position).slice(0, n).map((p) => p.n);
  const names = [
    ...pick("QB", 2), ...pick("RB", 4), ...pick("WR", 4),
    ...pick("TE", 2), ...pick("K", 1), ...pick("D/ST", 1),
  ];

  const slots = optimalLineup(names, LEAGUE);
  const labels = [...slots.values()];

  ok("one quarterback is marked", labels.filter((s) => s === "QB").length === 1);
  // Numbered where a league fields more than one, or two rows both read RB and
  // it looks like a mistake.
  ok("two running backs, numbered", labels.includes("RB1") && labels.includes("RB2"));
  ok("two receivers, numbered", labels.includes("WR1") && labels.includes("WR2"));
  ok("and the defense is not called D/ST in a chip", !labels.includes("D/ST") && labels.includes("DST"));
  ok("nobody is marked twice", new Set(labels).size === labels.length);
  ok("and the bench is not marked at all", slots.size < names.length);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
