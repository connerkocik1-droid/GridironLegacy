import { rank, winPctOf, RECORD_WEIGHT } from "../power";

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

const team = (id: string, wins: number, losses: number, pointsFor: number, ties = 0) => ({
  id,
  wins,
  losses,
  ties,
  pointsFor,
});

console.log("\n--- win percentage ---");
eq("no games is not a losing record, it is no record", winPctOf(team("a", 0, 0, 0)), 0);
eq("a tie is half a win", winPctOf(team("a", 1, 1, 0, 2)), 0.5);
eq("all wins is one", winPctOf(team("a", 4, 0, 0)), 1);

console.log("\n--- before a week has been graded ---");
{
  // Every record is 0-0, so weighting records would rank the league by
  // nothing at all. Points are the only thing that has happened.
  const table = rank([team("a", 0, 0, 900), team("b", 0, 0, 1100), team("c", 0, 0, 1000)]);
  eq("the highest scorer leads", table.map((t) => t.id), ["b", "c", "a"]);
  eq("the leader is the yardstick", table[0].rating, 100);
  eq("and the rest are their share of it", table[2].rating, 81.8);
  eq("nobody has a record to show", table.every((t) => t.games === 0), true);
}

console.log("\n--- once records exist ---");
{
  // Two 5-4 teams. The one that scored more is ahead, which is the whole
  // point of ranking on more than the table.
  const table = rank([team("scraper", 5, 4, 800), team("masher", 5, 4, 1200)]);
  eq("the same record breaks on points", table.map((t) => t.id), ["masher", "scraper"]);
  ok("and the gap is the points half only", Math.abs(
    (table[0].rating - table[1].rating) - (1 - RECORD_WEIGHT) * 100 * (1 - 800 / 1200),
  ) < 0.1);
}

{
  // Record still outweighs points: a much better record beats a slightly
  // better scoreline.
  const table = rank([team("winner", 8, 1, 1000), team("unlucky", 2, 7, 1100)]);
  eq("a far better record wins", table.map((t) => t.id), ["winner", "unlucky"]);
}

{
  // ...but not by any margin. An undefeated team that scores nothing is not
  // credible, and the points half says so.
  const table = rank([team("hollow", 9, 0, 100), team("real", 6, 3, 1200)]);
  ok("record alone does not carry a team that cannot score",
    table[0].rating - table[1].rating < 60);
}

console.log("\n--- ties and ordering ---");
{
  const table = rank([team("a", 3, 3, 900), team("b", 3, 3, 900)]);
  eq("identical teams still get distinct ranks", table.map((t) => t.rank), [1, 2]);
}

{
  const table = rank([team("a", 5, 0, 1000), team("b", 0, 5, 1000)]);
  eq("equal points, better record leads", table[0].id, "a");
}

console.log("\n--- movement ---");
{
  const before = new Map([["a", 1], ["b", 2], ["c", 3]]);
  const table = rank([team("a", 1, 2, 500), team("b", 3, 0, 900), team("c", 2, 1, 700)], before);
  eq("the order is the new one", table.map((t) => t.id), ["b", "c", "a"]);
  eq("climbing is positive", table.find((t) => t.id === "b")?.movement, 1);
  eq("falling is negative", table.find((t) => t.id === "a")?.movement, -2);
}

{
  // A week where nothing changed hands reports no movement rather than
  // inventing an arrow for every team.
  const before = new Map([["x", 1], ["y", 2]]);
  const table = rank([team("x", 3, 0, 900), team("y", 0, 3, 500)], before);
  eq("standing still is zero", table.map((t) => t.movement), [0, 0]);
}

{
  const table = rank([team("a", 1, 0, 500)]);
  eq("without a previous week there is no movement", table[0].movement, null);
}

console.log("\n--- degenerate leagues ---");
eq("an empty league ranks to nothing", rank([]), []);
{
  const table = rank([team("a", 0, 0, 0), team("b", 0, 0, 0)]);
  eq("a league that has done nothing rates zero", table.map((t) => t.rating), [0, 0]);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
