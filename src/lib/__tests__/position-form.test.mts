import { fieldedAt, positionForm, tierOf, type Scored } from "../position-form";

let failed = 0;
const ok = (label: string, cond: boolean) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failed++;
};

const POOL: Scored[] = [
  { name: "Best RB", position: "RB", points: 90, games: 3 },
  { name: "Good RB", position: "RB", points: 60, games: 3 },
  // Fewer games, so a total puts him below Good RB and a rate puts him above.
  { name: "Hurt RB", position: "RB", points: 45, games: 1 },
  { name: "Bad RB", position: "RB", points: 12, games: 3 },
  { name: "Best WR", position: "WR", points: 80, games: 4 },
  { name: "Other WR", position: "WR", points: 40, games: 4 },
  // Never played. A rank he has, a rate he has not.
  { name: "Unplayed WR", position: "WR", points: 0, games: 0 },
  // No position at all: a pickup the pool never heard of.
  { name: "Nobody", position: "", points: 30, games: 2 },
];

console.log("--- where a man stands at his own position ---");
{
  const form = positionForm(POOL);
  ok("the best at a position is first", form.get("Best RB")?.rank === 1);
  ok("and the rest follow him on points", form.get("Good RB")?.rank === 2 && form.get("Hurt RB")?.rank === 3);
  ok("positions are ranked separately", form.get("Best WR")?.rank === 1);
  ok("a player the pool cannot place is not ranked at all", !form.has("Nobody"));
}

console.log("\n--- and what he is worth a week ---");
{
  const form = positionForm(POOL);
  ok(`points per game, not points (${form.get("Good RB")?.ppg})`, form.get("Good RB")?.ppg === 20);
  // The whole reason a rate is drawn beside a rank: Hurt RB ranks below Good RB
  // on the total and is the better player per week.
  ok(`a man with fewer games is judged on the games he had (${form.get("Hurt RB")?.ppg})`,
    form.get("Hurt RB")?.ppg === 45 && form.get("Hurt RB")!.rank > form.get("Good RB")!.rank);
  ok("nobody who has not played is divided by nought", form.get("Unplayed WR")?.ppg === 0);
  ok("the yardstick is the best rate at the position, not on the roster",
    form.get("Bad RB")?.bestPpg === 45);
  ok("and each position has its own", form.get("Other WR")?.bestPpg === 20);
}

console.log("\n--- ties do not shuffle between reads ---");
{
  // A Sunday morning, everybody on nought. An order that changes every poll
  // looks broken.
  const flat: Scored[] = ["D", "A", "C", "B"].map((n) => ({
    name: n, position: "TE", points: 0, games: 0,
  }));
  const once = positionForm(flat);
  const again = positionForm([...flat].reverse());
  ok("the same table ranks the same way whatever order it arrives in",
    ["A", "B", "C", "D"].every((n) => once.get(n)!.rank === again.get(n)!.rank));
  ok("and it is alphabetical when nothing separates them", once.get("A")?.rank === 1);
}

console.log("\n--- what the league actually fields ---");
{
  const starters = { QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 2, "D/ST": 1, K: 1 };

  ok("one quarterback each in a twelve-team league is twelve",
    fieldedAt("QB", starters, 12) === 12);
  // The flex is a spot a back can start in, so it counts towards him.
  ok("backs get their own slots and the flexes too",
    fieldedAt("RB", starters, 12) === 48);
  ok("and so do receivers and tight ends",
    fieldedAt("WR", starters, 12) === 48 && fieldedAt("TE", starters, 12) === 36);
  ok("but a quarterback cannot be flexed in this league",
    fieldedAt("QB", starters, 12) === 12);
  ok("with no league to measure against, nothing is fielded",
    fieldedAt("RB", null, 12) === 0 && fieldedAt("RB", starters, 0) === 0);
}

console.log("\n--- and which of those a rank is ---");
{
  ok("the top half of the startable ranks is elite", tierOf(1, 12) === "elite" && tierOf(6, 12) === "elite");
  ok("the rest of them start", tierOf(7, 12) === "starter" && tierOf(12, 12) === "starter");
  ok("and past that is depth", tierOf(13, 12) === "depth");

  // The same rank means different things in different leagues, which is the
  // whole reason the tier is measured rather than hard-coded.
  ok("RB20 starts where 48 backs start", tierOf(20, 48) === "elite");
  ok("and is nobody's starter where 12 do", tierOf(20, 12) === "depth");

  ok("a league that fields nothing claims nothing", tierOf(1, 0) === "depth");
  ok("and neither does an unranked player", tierOf(0, 12) === "depth");
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
