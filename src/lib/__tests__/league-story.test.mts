/**
 * The league page writes its own prose, so the prose is what is tested.
 *
 * A generated sentence is only worth having if it is right in every state the
 * table can be in — and the states that matter are the awkward ones. Three
 * teams tied on the same streak. A week where nobody has played. A league
 * where everybody has won, so there is no winless item to write. A "best
 * value" who is in fact behind where he was drafted, because somebody has to
 * be the least bad.
 *
 * Each of those is a branch in league-story.ts, and each has a case here.
 */
import assert from "node:assert/strict";
import {
  bestValue,
  currentRank,
  gradeMove,
  hotStreaks,
  leagueNews,
  matchupRead,
  ordinal,
  recordOf,
  seasonPlayers,
  standings,
  topScorers,
  type Fixture,
  type Franchise,
  type PlayerSeason,
} from "../league-story";

let failed = 0;
function eq(label: string, got: unknown, want: unknown) {
  try {
    assert.deepEqual(got, want);
    console.log(`PASS  ${label}`);
  } catch {
    console.log(`FAIL  ${label} — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
    failed++;
  }
}
function ok(label: string, got: boolean, detail = "") {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  if (!got) failed++;
}

const TEAMS: Franchise[] = [
  { id: "a", franchise: "Alpha", owner: "Ana" },
  { id: "b", franchise: "Bravo", owner: "Ben" },
  { id: "c", franchise: "Charlie", owner: "Cass" },
  { id: "d", franchise: "Delta", owner: "Dev" },
];

/** Three graded weeks: Ana 3-0, Ben 2-1, Cass 1-2, Dev 0-3. */
const FIXTURES: Fixture[] = [
  { week: 1, home: "a", away: "d", homePoints: 120, awayPoints: 90, final: true },
  { week: 1, home: "b", away: "c", homePoints: 110, awayPoints: 100, final: true },
  { week: 2, home: "a", away: "c", homePoints: 130, awayPoints: 95, final: true },
  { week: 2, home: "b", away: "d", homePoints: 105, awayPoints: 88, final: true },
  { week: 3, home: "a", away: "b", homePoints: 118, awayPoints: 99, final: true },
  { week: 3, home: "c", away: "d", homePoints: 101, awayPoints: 80, final: true },
  // Not graded, so it counts towards nothing.
  { week: 4, home: "a", away: "c", homePoints: 0, awayPoints: 0, final: false },
];

console.log("--- the table ---");
{
  const rows = standings(TEAMS, FIXTURES);
  const ana = rows.find((r) => r.id === "a")!;
  const dev = rows.find((r) => r.id === "d")!;

  eq("a manager who won every week is unbeaten", recordOf(ana), "3-0");
  eq("and one who lost every week has no wins", recordOf(dev), "0-3");
  eq("points for adds up the graded weeks only", ana.pointsFor, 368);
  eq("and points against with it", ana.pointsAgainst, 284);
  eq("the streak counts the run, not the season", ana.streak, 3);
  eq("and says which kind it is", ana.streakKind, "W");
  eq("a losing run is a streak too", dev.streak, 3);
  eq("of the other kind", dev.streakKind, "L");

  // An ungraded fixture is a game nobody has won. Counting it would hand
  // everybody a loss on Thursday morning.
  eq("an ungraded week is not in the record", ana.results.length, 3);
}

console.log("\n--- a tie is a real outcome ---");
{
  const drawn = standings(
    [TEAMS[0], TEAMS[1]],
    [{ week: 1, home: "a", away: "b", homePoints: 100, awayPoints: 100, final: true }],
  );
  eq("neither of them won", recordOf(drawn[0]), "0-0-1");
  eq("and it shows in the record rather than being rounded away", drawn[0].ties, 1);
}

console.log("\n--- nothing played yet ---");
{
  const rows = standings(TEAMS, [{ ...FIXTURES[0], final: false }]);
  eq("every record is empty", recordOf(rows[0]), "0-0");
  eq("nobody is on a streak", rows[0].streak, 0);
  eq("and the streak has no kind", rows[0].streakKind, "");
  eq("so there is no hot hand to name", hotStreaks(rows).teams.length, 0);
  eq("and no news to write", leagueNews(rows, [], 0).length, 0);
}

console.log("\n--- the hot streak, when it is shared ---");
{
  // Two teams unbeaten at two, one at one: only the two belong on the card.
  const tied: Fixture[] = [
    { week: 1, home: "a", away: "c", homePoints: 120, awayPoints: 90, final: true },
    { week: 1, home: "b", away: "d", homePoints: 110, awayPoints: 80, final: true },
    { week: 2, home: "a", away: "d", homePoints: 130, awayPoints: 95, final: true },
    { week: 2, home: "b", away: "c", homePoints: 105, awayPoints: 88, final: true },
  ];
  const { best, teams } = hotStreaks(standings(TEAMS, tied));
  eq("the longest run is found", best, 2);
  eq("and everybody on it is named, not just the first", teams.length, 2);
  ok(
    "the two unbeaten teams, and neither of the others",
    teams.map((t) => t.id).sort().join(",") === "a,b",
    teams.map((t) => t.id).join(","),
  );

  const alone = hotStreaks(standings(TEAMS, FIXTURES));
  eq("a single leader is a list of one, not a special case", alone.teams.length, 1);
  eq("and it is the right one", alone.teams[0].owner, "Ana");
}

console.log("\n--- the news turns over with the table ---");
{
  const rows = standings(TEAMS, FIXTURES);
  const news = leagueNews(rows, [], 3);
  const tags = news.map((n) => n.tag);

  ok(`it writes what the table supports (${tags.join(", ")})`, tags.includes("SCORES"));
  ok("including the points-for leader", tags.includes("POINTS"));
  ok("and the streak", tags.includes("STREAK"));

  const peak = news.find((n) => n.tag === "SCORES")!;
  ok(`the highest week is the highest week (${peak.head})`, /130\.0/.test(peak.head));

  const cold = news.find((n) => n.tag === "COLD")!;
  ok(`a winless team is named (${cold.head})`, /Dev/.test(cold.head));

  // Everybody has won, so there is nothing to say about anybody who has not.
  const even: Fixture[] = [
    { week: 1, home: "a", away: "b", homePoints: 120, awayPoints: 90, final: true },
    { week: 2, home: "b", away: "a", homePoints: 120, awayPoints: 90, final: true },
  ];
  const both = leagueNews(standings([TEAMS[0], TEAMS[1]], even), [], 2);
  ok("and left out entirely when everybody has one", !both.some((n) => n.tag === "COLD"));
}

console.log("\n--- value against the draft ---");
{
  const players: PlayerSeason[] = [
    { name: "Riser", pos: "WR", team: "BUF", points: 300, games: 3, preRank: 31 },
    { name: "Steady", pos: "WR", team: "MIA", points: 200, games: 3, preRank: 2 },
    { name: "Faller", pos: "WR", team: "NYJ", points: 100, games: 3, preRank: 1 },
    { name: "Undrafted", pos: "WR", team: "NE", points: 250, games: 3, preRank: null },
  ];

  eq("rank is by points, not by draft slot", currentRank(players, "Riser"), 1);
  eq("and the man who was drafted first can be third", currentRank(players, "Faller"), 4);

  const value = bestValue(players, 3)!;
  eq("the biggest climb wins the card", value.player.name, "Riser");
  eq("counted in spots", value.gain, 30);
  ok(`and the sentence says so (${value.read})`, /30-spot climb/.test(value.read));
  ok("naming where he came from", /31st WR/.test(value.read));

  // A man with no draft rank cannot have climbed from one. Letting him in
  // would hand the card to whichever undrafted player scored twice.
  ok("somebody never ranked cannot be the biggest riser", value.player.name !== "Undrafted");

  // Somebody has to be the least bad, and "climbed −4 spots" is not English.
  const sinking: PlayerSeason[] = [
    { name: "Less Bad", pos: "RB", team: "DAL", points: 200, games: 3, preRank: 1 },
    { name: "Worse", pos: "RB", team: "PHI", points: 100, games: 3, preRank: 2 },
  ];
  const none = bestValue(sinking, 3)!;
  eq("with nobody ahead of their draft slot the gain is nought", none.gain, 0);
  ok(`and the sentence turns over rather than claiming a climb (${none.read})`,
    !/climb/.test(none.read));

  eq("no ranked players at all is null, not a crash", bestValue([], 3), null);
}

console.log("\n--- the top three ---");
{
  const players: PlayerSeason[] = [
    { name: "One", pos: "RB", team: "A", points: 90, games: 3, preRank: 1 },
    { name: "Two", pos: "WR", team: "B", points: 80, games: 3, preRank: 2 },
    { name: "Three", pos: "TE", team: "C", points: 70, games: 3, preRank: 3 },
    { name: "Four", pos: "QB", team: "D", points: 60, games: 3, preRank: 4 },
  ];
  eq("three of them", topScorers(players).length, 3);
  eq("in order", topScorers(players).map((p) => p.name), ["One", "Two", "Three"]);
  eq("a short league gives what it has", topScorers(players.slice(0, 2)).length, 2);
}

console.log("\n--- what a move turned out to be ---");
{
  const players: PlayerSeason[] = [
    { name: "Riser", pos: "WR", team: "BUF", points: 300, games: 3, preRank: 31 },
    { name: "Steady", pos: "WR", team: "MIA", points: 200, games: 3, preRank: 2 },
    { name: "Faller", pos: "WR", team: "NYJ", points: 100, games: 3, preRank: 1 },
  ];

  const got = gradeMove(
    { kind: "TRADE", who: "Ana", player: "Riser", side: "in" }, players, 3)!;
  eq("thirty spots toward you is a steal", got.grade, "STEAL");
  ok(`and it says which way the value went (${got.read})`, /toward Ana/.test(got.read));

  const gave = gradeMove(
    { kind: "TRADE", who: "Ben", player: "Riser", side: "out" }, players, 3)!;
  eq("the same player going the other way is not", gave.grade, "RISKY");
  ok("and the sentence knows whose problem it is", /Ben will hear about/.test(gave.read));

  const flat = gradeMove(
    { kind: "ADD", who: "Cass", player: "Steady", side: "in" }, players, 3)!;
  eq("a player roughly where he was drafted is even", flat.grade, "EVEN");
  ok(`and nobody is credited (${flat.read})`, /nobody won this one/.test(flat.read));

  eq("a player nobody has scored cannot be graded",
    gradeMove({ kind: "ADD", who: "Ana", player: "Ghost", side: "in" }, players, 3), null);
}

console.log("\n--- reading a fixture ---");
{
  ok(`a coin toss says so (${matchupRead("Alpha", "Bravo", 1.2)})`,
    /Nothing in it/.test(matchupRead("Alpha", "Bravo", 1.2)));
  ok("a normal gap names the favourite",
    /Alpha project 9\.0 clear/.test(matchupRead("Alpha", "Bravo", 9)));
  ok("and a blowout reads as one",
    /badly wrong/.test(matchupRead("Alpha", "Bravo", 40)));
  ok("a negative gap is the same size as a positive one",
    matchupRead("Alpha", "Bravo", -9) === matchupRead("Alpha", "Bravo", 9));
}

console.log("\n--- the small print ---");
{
  eq("first", ordinal(1), "1st");
  eq("second", ordinal(2), "2nd");
  eq("third", ordinal(3), "3rd");
  eq("fourth", ordinal(4), "4th");
  // The teens are the whole reason this is a function.
  eq("eleventh, not eleven-st", ordinal(11), "11th");
  eq("twelfth", ordinal(12), "12th");
  eq("thirteenth", ordinal(13), "13th");
  eq("twenty-first", ordinal(21), "21st");
  eq("one hundred and eleventh", ordinal(111), "111th");
}

console.log("\n--- joined to the pool ---");
{
  // Real names, because the join is against the real draft pool.
  const players = seasonPlayers({
    "Ja'Marr Chase": { total: 300, games: 3 },
    "Brock Bowers": { total: 200, games: 3 },
  });
  eq("both come through", players.length, 2);
  ok("with their position from the pool", players.every((p) => p.pos.length > 0));
  ok("and a draft rank to be judged against",
    players.every((p) => p.preRank != null && p.preRank > 0),
    JSON.stringify(players.map((p) => [p.name, p.pos, p.preRank])));
  ok("highest scorer first", players[0].name === "Ja'Marr Chase");

  const unknown = seasonPlayers({ "Nobody At All": { total: 10, games: 1 } });
  eq("a player the pool has never heard of still counts", unknown.length, 1);
  eq("but has no draft rank to have beaten", unknown[0].preRank, null);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
