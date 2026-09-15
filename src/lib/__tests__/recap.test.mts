import {
  beatAt,
  beatPlan,
  marginLine,
  mvpNote,
  nextOpponentLine,
  ordinal,
  recapFacts,
  recapIsDue,
  recapOpensAt,
  recordOf,
  resultsThrough,
  standingAfter,
  standingsNote,
  streakLine,
  topScoreLine,
  weekBoard,
  type RecapData,
  type RecapGame,
} from "../recap";

let failed = 0;
const ok = (label: string, cond: boolean) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failed++;
};

// A four-team league so a whole table can be checked by eye, played out over
// three weeks. ME is "a".
const TEAMS = [
  { id: "a", franchise: "Steel Cartel", owner: "Conner" },
  { id: "b", franchise: "Bay Area Brawlers", owner: "Dana" },
  { id: "c", franchise: "Thunderbolts", owner: "Kim" },
  { id: "d", franchise: "Nine Lives", owner: "Jo" },
];

const GAMES: RecapGame[] = [
  { week: 1, home: "a", away: "b", homePoints: 120.0, awayPoints: 110.0 },
  { week: 1, home: "c", away: "d", homePoints: 100.0, awayPoints: 130.0 },
  { week: 2, home: "a", away: "c", homePoints: 90.0, awayPoints: 140.0 },
  { week: 2, home: "b", away: "d", homePoints: 125.0, awayPoints: 118.0 },
  { week: 3, home: "a", away: "d", homePoints: 131.6, awayPoints: 118.4 },
  { week: 3, home: "b", away: "c", homePoints: 122.0, awayPoints: 145.2 },
];

// Deliberately not in points order: the lineup arrives in slot order, and an
// MVP taken off the top of the list rather than off the top of the scoring
// would be whoever happens to play quarterback.
const MY_WEEK = [
  { name: "Bijan Robinson", position: "RB", team: "ATL", points: 25.1 },
  { name: "Trey McBride", position: "TE", team: "ARI", points: 11.0 },
  { name: "Lamar Jackson", position: "QB", team: "BAL", points: 31.6 },
  { name: "Brock Bowers", position: "TE", team: "LV", points: 12.3 },
  { name: "Ja'Marr Chase", position: "WR", team: "CIN", points: 27.8 },
  { name: "Ashton Jeanty", position: "RB", team: "LV", points: 23.8 },
];

const DATA: RecapData = {
  week: 3,
  meId: "a",
  teams: TEAMS,
  games: GAMES,
  myWeek: MY_WEEK,
  next: { week: 4, opponentId: "b", kickoff: "2026-09-24T20:15:00Z" },
};

console.log("--- when the recap opens ---");
{
  // Monday Night Football, week 3 of 2026: 8:15pm ET on 21 September, which is
  // 00:15 UTC on the 22nd. The recap belongs to the Tuesday after it.
  const mnf = "2026-09-22T00:15:00Z";
  const opens = recapOpensAt(mnf, null);
  const et = new Date(opens!).toLocaleString("en-US", { timeZone: "America/New_York" });
  ok(`Monday night's game opens the Tuesday after it (${et})`, et.startsWith("9/22/2026, 12:00:00 AM"));

  // A week whose last game is on the Sunday still waits for Tuesday, not for
  // the next midnight — the football week has a shape and Monday is in it.
  const sunday = recapOpensAt("2026-09-20T20:25:00Z", null);
  const sundayEt = new Date(sunday!).toLocaleString("en-US", { timeZone: "America/New_York" });
  ok(`a Sunday finish still waits for Tuesday (${sundayEt})`,
    sundayEt.startsWith("9/22/2026, 12:00:00 AM"));

  // March, when New York is on daylight time and the naive UTC arithmetic is
  // an hour out. The recap must still open at midnight local.
  const spring = recapOpensAt("2026-03-09T23:15:00Z", null);
  const springEt = new Date(spring!).toLocaleString("en-US", { timeZone: "America/New_York" });
  ok(`daylight saving does not shift midnight (${springEt})`,
    springEt.startsWith("3/10/2026, 12:00:00 AM"));

  // No fixtures on record. A graded week means the football is over, so the
  // grade itself is the best answer available rather than no answer at all.
  const graded = recapOpensAt(null, "2026-09-22T04:00:00Z");
  ok("with no kickoff on record the grade stands in", graded === Date.parse("2026-09-22T04:00:00Z"));
  ok("and with neither, there is nothing to open", recapOpensAt(null, null) === null);
}

console.log("\n--- and whether it is due ---");
{
  const opens = recapOpensAt("2026-09-22T00:15:00Z", null)!;
  ok("not before it opens", !recapIsDue({ week: 3, seenWeek: null, opensAt: opens, now: opens - 1 }));
  ok("due the moment it does", recapIsDue({ week: 3, seenWeek: null, opensAt: opens, now: opens }));
  ok("not once it has been seen", !recapIsDue({ week: 3, seenWeek: 3, opensAt: opens, now: opens + 1 }));
  ok("but the next week is still due", recapIsDue({ week: 4, seenWeek: 3, opensAt: opens, now: opens + 1 }));
  ok("nothing graded, nothing to play",
    !recapIsDue({ week: null, seenWeek: null, opensAt: opens, now: opens + 1 }));
  ok("and a week nobody can date does not play",
    !recapIsDue({ week: 3, seenWeek: null, opensAt: null, now: opens + 1 }));
}

console.log("\n--- the table it is all read off ---");
{
  ok("results are in week order", resultsThrough(GAMES, "a", 3).join("") === "WLW");
  ok("a record counts them", recordOf(GAMES, "a", 3) === "2-1");
  ok("and stops where it is told to", recordOf(GAMES, "a", 2) === "1-1");

  const board = weekBoard(DATA, 3);
  ok(`the week's board is highest first (${board.map((r) => r.points).join(", ")})`,
    board.map((r) => r.id).join("") === "cabd");
  ok("and holds every side of every game", board.length === 4);

  // After week 3: c and a are 2-1, d and b are 1-2. Wins order the four, and
  // points for splits each pair — d has scored more than b, and c more than a,
  // so a sort on points alone would put d above a and be wrong.
  ok(`standings are wins first, points for second (${standingAfter(DATA, 3).join("")})`,
    standingAfter(DATA, 3).join("") === "cadb");
  ok("11th is not 11st", ordinal(11) === "11th" && ordinal(21) === "21st" && ordinal(3) === "3rd");
}

console.log("\n--- the facts of the week ---");
{
  const f = recapFacts(DATA)!;
  ok("it knows who won", f.won && !f.tied);
  ok(`by how much (${f.margin})`, f.margin === 13.2);
  ok("who it was against", f.opponent?.id === "d");
  ok("who scored most in the league that week", f.top?.id === "c" && !f.topIsMe);
  ok(`and where that left you (${f.myWeekRank} of ${f.teamsInWeek})`,
    f.myWeekRank === 2 && f.teamsInWeek === 4);

  // Derived from what the lineup scored, never nominated.
  ok("the MVP is the top scorer", f.mvp?.name === "Lamar Jackson");
  ok("the second is the second", f.second?.name === "Ja'Marr Chase");
  ok(`and the share is his of the whole (${f.share.toFixed(1)}%)`,
    Math.abs(f.share - (31.6 / 131.6) * 100) < 0.01);

  // After week 2 every side is 1-1 and this manager has scored the fewest, so
  // they sit last; week 3 lifts them to second. Measured against the table as
  // it stood, not against a remembered position.
  ok(`the standings move is measured against last week (${f.rankBefore} → ${f.rankAfter})`,
    f.rankBefore === 4 && f.rankAfter === 2 && f.moved === 2);
  ok("next week's opponent comes with their form", f.next?.team.id === "b" && f.next.record === "1-2");
  ok("and it knows you have played them", f.next?.rematch === true);
}

console.log("\n--- the postseason is not the season ---");
{
  // A bracket is not a league table. The playoff week can still be recapped —
  // it happened, and it has a board and an MVP like any other — but it must
  // not appear in a record, in points for, or in the standings the recap says
  // you moved within.
  const withPlayoff: RecapData = {
    ...DATA,
    week: 4,
    games: [
      ...GAMES,
      { week: 4, home: "a", away: "c", homePoints: 140.0, awayPoints: 100.0, playoff: true },
      { week: 4, home: "b", away: "d", homePoints: 110.0, awayPoints: 120.0, playoff: true },
    ],
    next: null,
  };
  const f = recapFacts(withPlayoff)!;
  ok("the playoff week itself is recapped", f.won && f.margin === 40);
  ok(`but the record still reads the season (${f.record})`, f.record === "2-1");
  ok(`and points for stops at the regular season (${f.myPointsFor})`, f.myPointsFor === 341.6);
  ok("so the table does not move", f.rankBefore === 2 && f.rankAfter === 2 && f.moved === 0);
  ok("while the week's board is the games that were played",
    f.top?.id === "a" && f.teamsInWeek === 4);
}

console.log("\n--- a bye is not a week ---");
{
  const bye: RecapData = { ...DATA, week: 4 };
  ok("a week this manager did not play has no recap", recapFacts(bye) === null);
  ok("and neither has a manager who is not in the league",
    recapFacts({ ...DATA, meId: "zzz" }) === null);
}

console.log("\n--- every line branches ---");
{
  const f = recapFacts(DATA)!;
  ok(`the margin reads plainly in the middle (${marginLine(f)})`,
    marginLine(f) === "Won by 13.2");

  const blowout = recapFacts({ ...DATA, games: GAMES.map((g) =>
    g.week === 3 && g.home === "a" ? { ...g, awayPoints: 90.0 } : g) })!;
  ok(`over twenty is never in doubt (${marginLine(blowout)})`, /never in doubt/.test(marginLine(blowout)));

  const squeaker = recapFacts({ ...DATA, games: GAMES.map((g) =>
    g.week === 3 && g.home === "a" ? { ...g, awayPoints: 129.0 } : g) })!;
  ok(`under five is the closest week (${marginLine(squeaker)})`,
    /closest week of your season/.test(marginLine(squeaker)));

  const drawn = recapFacts({ ...DATA, games: GAMES.map((g) =>
    g.week === 3 && g.home === "a" ? { ...g, awayPoints: 131.6 } : g) })!;
  ok(`and a tie is neither (${marginLine(drawn)})`, /Tied at 131.6/.test(marginLine(drawn)));

  // A streak of one is its own sentence: "1 straight wins" is not English.
  ok(`a streak of one is worded (${streakLine(f)})`, /Back in the win column/.test(streakLine(f)));
  const twoUp = recapFacts({ ...DATA, games: GAMES.map((g) =>
    g.week === 2 && g.home === "a" ? { ...g, homePoints: 150.0 } : g) })!;
  ok(`and a longer one counts (${streakLine(twoUp)})`, /3 straight wins/.test(streakLine(twoUp)));

  ok(`the top score names its owner when it is not yours (${topScoreLine(f)})`,
    /Kim put up the week's best/.test(topScoreLine(f)) && /2nd of 4/.test(topScoreLine(f)));
  const mineOnTop = recapFacts({ ...DATA, games: GAMES.map((g) =>
    g.week === 3 && g.home === "b" ? { ...g, awayPoints: 100.0 } : g) })!;
  ok(`and says so when it is (${topScoreLine(mineOnTop)})`,
    /Nobody in the league scored more/.test(topScoreLine(mineOnTop)));

  // 31.6 of 131.6 is 24%, just under the threshold, so this is the balanced
  // branch rather than the carried one.
  ok(`the MVP note reads the share (${mvpNote(f)})`, /balanced week: 4 of your players cleared 20/.test(mvpNote(f)));
  const carried = recapFacts({ ...DATA, myWeek: [
    { name: "Lamar Jackson", position: "QB", team: "BAL", points: 40.0 },
    { name: "Ja'Marr Chase", position: "WR", team: "CIN", points: 9.0 },
  ] })!;
  ok(`a big share is carried alone (${mvpNote(carried)})`, /Carried the week almost alone/.test(mvpNote(carried)));
  const lost = recapFacts({ ...DATA, week: 2 })!;
  ok(`and a loss says it was not enough (${mvpNote(lost)})`, /was not enough by 50.0/.test(mvpNote(lost)));

  ok(`the standings note reads the direction (${standingsNote(f)})`, /Climbed to 2 of 4/.test(standingsNote(f)));
  const slipped = recapFacts({ ...DATA, week: 2 })!;
  ok(`a fall says so rather than saying nothing (${standingsNote(slipped)})`,
    /Slipped to 4 of 4/.test(standingsNote(slipped)));
  ok(`and next week's opponent gets a read (${nextOpponentLine(f)})`,
    /already seen them once/.test(nextOpponentLine(f)) && /Dana comes in off a loss/.test(nextOpponentLine(f)));
}

console.log("\n--- the clock ---");
{
  const { starts, end } = beatPlan([1000, 2000, 3000]);
  ok(`beats start where the one before ended (${starts.join(", ")})`, starts.join(",") === "0,1000,3000");
  ok("and the end is the whole run", end === 6000);
  ok("a moment falls in the right beat", beatAt(0, starts) === 0 && beatAt(2999, starts) === 1 && beatAt(3000, starts) === 2);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
