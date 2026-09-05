import { records, longestStreak, type RecordGame } from "../records";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}`}`);
  if (!pass) failed++;
};

const game = (
  week: number,
  home: string,
  hp: number | null,
  away: string,
  ap: number | null,
  final = true,
): RecordGame => ({
  week,
  final,
  home: { id: home, franchise: home, points: hp },
  away: { id: away, franchise: away, points: ap },
});

console.log("\n--- nothing has been played ---");
{
  const r = records([]);
  eq("no games, no records", [r.highest, r.biggest, r.closest, r.streak], [null, null, null, null]);
  eq("and it says so", r.played, 0);
}

console.log("\n--- a week still being played is not a record ---");
{
  // The whole point: a score that is still moving would take the crown at
  // four o'clock and hand it back at half past.
  const r = records([game(1, "A", 200, "B", 80, false)]);
  eq("an unsettled week counts for nothing", r.played, 0);
  eq("and sets no high score", r.highest, null);
}

console.log("\n--- a game with a side that never scored ---");
{
  const r = records([game(1, "A", 120, "B", null)]);
  eq("a missing score is not a nought", r.played, 0);
}

console.log("\n--- the ordinary records ---");
{
  const r = records([
    game(1, "A", 120.5, "B", 100.0),
    game(1, "C", 88.2, "D", 88.0),
    game(2, "A", 170.4, "C", 60.1),
    game(2, "B", 99.9, "D", 140.2),
  ]);
  eq("three games settled", r.played, 4);
  eq("the highest score", [r.highest?.franchise, r.highest?.points, r.highest?.week], ["A", 170.4, 2]);
  // Rounded, because a margin is subtraction of floats and 0.20000000000000284
  // is not a thing anybody says. One decimal is what the screen prints.
  const to1 = (n?: number) => (n == null ? null : Number(n.toFixed(1)));
  eq("the biggest win", [r.biggest?.winner, r.biggest?.loser, to1(r.biggest?.margin)], ["A", "C", 110.3]);
  eq("the closest game", [r.closest?.winner, r.closest?.loser, to1(r.closest?.margin)], ["C", "D", 0.2]);
  eq("the most points scored in a loss", [r.unluckiest?.franchise, r.unluckiest?.points], ["B", 100]);
}

console.log("\n--- streaks ---");
{
  const done = [
    game(1, "A", 100, "B", 90),
    game(2, "A", 100, "C", 90),
    game(3, "A", 100, "D", 90),
    game(1, "C", 80, "D", 90),
  ];
  eq("three straight wins", longestStreak(done), { franchise: "A", run: 3 });
}
{
  const done = [game(1, "A", 10, "B", 90), game(2, "A", 10, "C", 90)];
  eq("a slump counts too, and is negative", longestStreak(done), { franchise: "A", run: -2 });
}
{
  const done = [game(1, "A", 100, "B", 90)];
  eq("one win is not a streak", longestStreak(done), null);
}
{
  // "Unbeaten in four" is a different claim from "won four", and the second
  // is the one worth printing.
  const done = [game(1, "A", 100, "B", 90), game(2, "A", 90, "C", 90), game(3, "A", 100, "D", 90)];
  eq("a tie ends a run rather than extending it", longestStreak(done), null);
}
{
  // Same length, one winning and one losing: the league would rather read
  // about a run than a slump.
  const done = [
    game(1, "A", 100, "X", 90),
    game(2, "A", 100, "Y", 90),
    game(1, "B", 10, "X", 90),
    game(2, "B", 10, "Y", 90),
  ];
  eq("wins beat losses of the same length", longestStreak(done)?.franchise, "A");
}
{
  const done = [
    game(1, "A", 100, "X", 90),
    game(2, "A", 100, "Y", 90),
    game(1, "B", 100, "P", 90),
    game(2, "B", 100, "Q", 90),
    game(3, "B", 100, "R", 90),
  ];
  eq("the longest run wins", longestStreak(done), { franchise: "B", run: 3 });
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exit(1);
