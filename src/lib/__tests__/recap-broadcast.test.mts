import { recapFacts, type RecapData, type RecapGame } from "../recap";
import {
  BROADCAST_END,
  broadcastBeat,
  highScore,
  mvpLine,
  nextLine,
  playoffPicture,
  seedsThrough,
  tapTarget,
  verdictLine,
  verdictNote,
} from "../recap-broadcast";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!pass) failed++;
};

// Six franchises in two divisions, four make the playoffs, six regular weeks;
// three played. Worked by hand:
//
//   after week 2   a 1-1 220 · b 1-1 220 · c 1-1 200 · d 2-0 215 · e 1-1 245 · f 0-2 175
//   after week 3   a 2-1 360 · b 1-2 310 · c 1-2 280 · d 2-1 335 · e 2-1 370 · f 1-2 275
//
// After week 3 the North's winner is a and the South's is e (level with d on
// record, ahead on points), so: e, a, then d, b, c, f.
const TEAMS = [
  { id: "a", franchise: "Steel Cartel", owner: "Conner", slot: "T01", division: "North" },
  { id: "b", franchise: "Bay Area Brawlers", owner: "Dana", slot: "T02", division: "North" },
  { id: "c", franchise: "Thunderbolts", owner: "Kim", slot: "T03", division: "North" },
  { id: "d", franchise: "Dust Devils", owner: "Jo", slot: "T04", division: "South" },
  { id: "e", franchise: "Gold Coast", owner: "Pat", slot: "T05", division: "South" },
  { id: "f", franchise: "Nine Lives", owner: "Sam", slot: "T06", division: "South" },
];

const GAMES: RecapGame[] = [
  { week: 1, home: "a", away: "b", homePoints: 120, awayPoints: 100 },
  { week: 1, home: "c", away: "d", homePoints: 90, awayPoints: 110 },
  { week: 1, home: "e", away: "f", homePoints: 130, awayPoints: 80 },
  { week: 2, home: "a", away: "c", homePoints: 100, awayPoints: 110 },
  { week: 2, home: "b", away: "e", homePoints: 120, awayPoints: 115 },
  { week: 2, home: "d", away: "f", homePoints: 105, awayPoints: 95 },
  { week: 3, home: "a", away: "d", homePoints: 140, awayPoints: 120 },
  { week: 3, home: "b", away: "f", homePoints: 90, awayPoints: 100 },
  { week: 3, home: "c", away: "e", homePoints: 80, awayPoints: 125 },
];

const MY_WEEK = [
  { name: "Bijan Robinson", position: "RB", team: "ATL", points: 25 },
  { name: "Lamar Jackson", position: "QB", team: "BAL", points: 31 },
  { name: "Ja'Marr Chase", position: "WR", team: "CIN", points: 28 },
  { name: "Brock Bowers", position: "TE", team: "LV", points: 12 },
  { name: "Trey McBride", position: "TE", team: "ARI", points: 9 },
  { name: "Ashton Jeanty", position: "RB", team: "LV", points: 35 },
];

const data = (over: Partial<RecapData> = {}): RecapData => ({
  week: 3,
  meId: "a",
  teams: TEAMS,
  games: GAMES,
  myWeek: MY_WEEK,
  next: { week: 4, opponentId: "b", kickoff: null },
  playoffTeams: 4,
  regularWeeks: 6,
  ...over,
});

console.log("--- the clock ---");
eq("a tap in the first beat goes to just before the second", tapTarget(0), 2850);
eq("one already past that goes to the third", tapTarget(2900), 5650);
eq("and one in the last beat ends it", tapTarget(9500), BROADCAST_END);
eq("beats", [0, 3199, 3200, 6000, 9000].map(broadcastBeat), [0, 0, 1, 2, 3]);

console.log("\n--- seeding, the database's way ---");
eq("division winners first, then the best records", seedsThrough(data(), 3).map((r) => r.id), ["e", "a", "d", "b", "c", "f"]);
eq("a level division is settled on points, then slot", seedsThrough(data(), 2).map((r) => r.id), ["d", "a", "e", "b", "c", "f"]);

console.log("\n--- the playoff picture ---");
{
  const f = recapFacts(data())!;
  const p = playoffPicture(data(), f);
  eq("seed before and after", [p.seedBefore, p.seedAfter], [2, 2]);
  eq("held", [p.tag, p.tone], ["HELD", "held"]);
  eq("and where in the division", p.note, "Holding 2nd · 1st in the North");
  // 6 + 1 − a's 2 wins − c's 2 losses (c is first outside).
  eq("the magic number", [p.kicker, p.number], ["MAGIC NUMBER", "3"]);
  eq("names who it is against", /Thunderbolts/.test(p.clinchNote), true);
}
{
  const d = data({ regularWeeks: 3 });
  const p = playoffPicture(d, recapFacts(d)!);
  eq("with the season over and nobody able to catch you, clinched", [p.kicker, p.number], ["CLINCHED", "✓"]);
}
{
  // c, fifth: level with b on wins but behind on points.
  const d = data({ meId: "c", next: null });
  const p = playoffPicture(d, recapFacts(d)!);
  eq("out, level on wins: out on tiebreak", [p.kicker, p.number], ["OUT ON TIEBREAK", "0"]);
  // 6 + 1 − b's 1 win − c's 2 losses.
  eq("with the elimination number", /Elimination number 4\./.test(p.clinchNote), true);
  eq("and a fall from the seed before", [p.seedBefore, p.seedAfter, p.tag], [5, 5, "HELD"]);
}
{
  const d = data({ meId: "e", next: null });
  const p = playoffPicture(d, recapFacts(d)!);
  eq("a climb is counted", [p.seedBefore, p.seedAfter, p.tag], [3, 1, "▲ 2"]);
}

console.log("\n--- the sentences ---");
{
  const f = recapFacts(data())!;
  eq("the verdict line", verdictLine(f), "Won by 20.0 · now 2-1 · W1");
  eq("twenty exactly is not 'never in doubt'", verdictNote(f), "");
  eq("the high score was yours", highScore(f), {
    kicker: "HIGH SCORE OF THE WEEK · YOU",
    line: "Best in the league by 15.0",
    sub: "Gold Coast was next at 125.0",
  });
  // Jeanty's 35 of 140 is exactly 25%: not over, so a won week reads balanced.
  eq("a balanced win", mvpLine(f), "Led a balanced week: 5 players in double figures.");
  eq(
    "next week: the rematch and the scoring",
    nextLine(data(), f),
    "Rematch: you won the first meeting. Averaging 103.3, 16.7 less than you.",
  );
}
{
  const d = data({
    meId: "c",
    next: { week: 4, opponentId: "f", kickoff: null },
    myWeek: [
      { name: "Lamar Jackson", position: "QB", team: "BAL", points: 44 },
      { name: "Brock Bowers", position: "TE", team: "LV", points: 20 },
      { name: "Trey McBride", position: "TE", team: "ARI", points: 16 },
    ],
  });
  const f = recapFacts(d)!;
  eq("somebody else's high score, and where yours sat", highScore(f)?.sub, "Your 80.0 was 6th of 6");
  eq("a loss by more than twenty", verdictNote(f), "Never in doubt.");
  eq("an MVP who carried a loss", /^Carried the week almost alone/.test(mvpLine(f)), true);
  eq("a first meeting", nextLine(d, f).startsWith("First meeting this season."), true);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
