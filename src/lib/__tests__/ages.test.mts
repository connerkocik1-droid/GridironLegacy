import { AGES, POOL, ageOf } from "../../data/league-data";

/**
 * How old everybody is, worked out rather than looked up.
 *
 * The pool used to carry a listed age for about half its players and nothing
 * for the rest. A listed age is right on the day it is written and wrong for
 * the rest of the year: a table built in July has a man at 24 through the
 * following June, and for half of those months he is 25. The birthday does not
 * drift, so the birthday is what is stored.
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

console.log("--- the arithmetic ---");
{
  const born = (dob: string) => {
    const name = `Test ${dob}`;
    (AGES as Record<string, { dob: string; exp: number }>)[name] = { dob, exp: 0 };
    return { n: name };
  };

  eq("a birthday last month", ageOf(born("2000-01-15"), "2026-02-01"), 26);
  eq("a birthday next month", ageOf(born("2000-03-15"), "2026-02-01"), 25);
  // The two cases an off-by-one lives in.
  eq("a birthday today", ageOf(born("2000-02-01"), "2026-02-01"), 26);
  eq("a birthday tomorrow", ageOf(born("2000-02-02"), "2026-02-01"), 25);
  eq("born on the 29th of February", ageOf(born("2004-02-29"), "2026-03-01"), 22);
  eq("and a date nobody can read is not an age", ageOf(born("not-a-date"), "2026-02-01"), null);
}

console.log("\n--- and everybody has one ---");
{
  const skill = POOL.filter((p) => p.p !== "D/ST");
  const withAge = skill.filter((p) => ageOf(p) != null);
  const from = skill.filter((p) => AGES[p.n]?.dob);

  ok(`nearly all of them (${withAge.length} of ${skill.length})`, withAge.length / skill.length > 0.98);
  ok(`and nearly all from a real birthday (${from.length})`, from.length / skill.length > 0.97);

  // A defense has no birthday, and asking for one must not invent a number.
  eq("a team defense has no age", ageOf({ n: POOL.find((p) => p.p === "D/ST")!.n }), null);
}

console.log("\n--- and none of them is absurd ---");
{
  // The guard that caught two real collisions: matching a name against every
  // player nflverse has ever had a row for made the Chiefs' Justin Watson
  // fifty-one, because a different Justin Watson played in the nineties.
  const ages = POOL.filter((p) => p.p !== "D/ST")
    .map((p) => ({ n: p.n, age: ageOf(p) }))
    .filter((x): x is { n: string; age: number } => x.age != null);

  const tooOld = ages.filter((x) => x.age > 46);
  const tooYoung = ages.filter((x) => x.age < 20);
  for (const x of [...tooOld, ...tooYoung]) console.log(`   ${x.n} is ${x.age}`);

  ok(`nobody is older than any NFL player has been (${Math.max(...ages.map((x) => x.age))})`,
    tooOld.length === 0);
  ok(`nor younger than anybody may be (${Math.min(...ages.map((x) => x.age))})`,
    tooYoung.length === 0);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
