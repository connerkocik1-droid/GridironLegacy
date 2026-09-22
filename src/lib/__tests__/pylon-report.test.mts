import {
  joinBreakdowns,
  keyOf,
  moveLabel,
  movement,
  parseBreakdowns,
  parseRankings,
  readRecord,
  summarise,
} from "../pylon-report";

let failed = 0;
const ok = (label: string, cond: boolean) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failed++;
};
const eq = (label: string, got: unknown, want: unknown) =>
  ok(`${label} — got ${JSON.stringify(got)}`, JSON.stringify(got) === JSON.stringify(want));

// The sheet as Excel hands it over: a header row, then a rank and two pairs of
// team and record. Tab separated, with the corruptions a real paste carries —
// "1.0" for a rank, a date serial where "2-0" was typed, a trailing space on a
// team's name.
//
// Twenty-five deep on the college side and thirty-two on the NFL, which is the
// shape the boards are now. The two being different lengths is the part worth
// having a fixture for: rows twenty-six to thirty-two carry an NFL club and an
// empty college pair, so the column positions only hold if the empty cells
// survive the split.
const SHEET = [
  "College Football\t\t\tNFL\t",
  "1.0\tGeorgia\t2-0\tSan Francisco 49ers\t1-0",
  "2.0\tMiami\t2-0\tChicago Bears\t0-1",
  "3\tTexas\t2-0\tKansas City Chiefs\t1-0",
  "4\tOhio State\t46023.0\tJacksonville Jaguars\t1-0",
  "5\tNotre Dame\t2-0\tSeattle Seahawks\t0-1",
  "6\tIndiana\t2-0\tNew York Giants\t1-0",
  "7\tLSU\t2-0\tBaltimore Ravens\t1-0",
  "8\tOle Miss\t2-0\tLos Angeles Rams\t0-1",
  "9\tUSC\t2-0\tMinnesota Vikings\t1-0",
  "10\tPenn State\t2-0\tDetroit Lions\t1-0",
  "11\tTexas A&M\t2-0\tDenver Broncos\t0-1",
  "12\tAlabama\t2-0\tCincinatti Bengals\t1-0",
  "13\tBYU\t2-0\tPhiladelphia Eagles\t1-0",
  "14\tTennessee\t2-0\tGreen Bay Packers \t0-1",
  "15\tTexas Tech\t2-0\tBuffalo Bills\t1-0",
  "16\tLouisville\t2-0\tNew England Patriots\t1-0",
  "17\tSMU\t2-0\tCarolina Panthers\t0-1",
  "18\tUtah\t2-0\tPittsburgh Steelers\t1-0",
  "19\tIowa\t2-0\tHouston Texans\t1-0",
  "20\tMissouri\t2-0\tNew York Jets\t0-1",
  "21\tOregon\t2-0\tDallas Cowboys\t1-0",
  "22\tMichigan\t2-0\tAtlanta Falcons\t1-0",
  "23\tClemson\t2-0\tLas Vegas Raiders\t0-1",
  "24\tFlorida State\t2-0\tTampa Bay Buccaneers\t1-0",
  "25\tAuburn\t2-0\tArizona Cardinals\t1-0",
  "26\t\t\tCleveland Browns\t0-1",
  "27\t\t\tIndianapolis Colts\t1-0",
  "28\t\t\tLos Angeles Chargers\t1-0",
  "29\t\t\tNew Orleans Saints\t0-1",
  "30\t\t\tTennessee Titans\t1-0",
  "31\t\t\tWashington Commanders\t1-0",
  "32\t\t\tMiami Dolphins\t0-1",
].join("\n");

console.log("--- the sheet, as it is actually kept ---");
{
  const r = parseRankings(SHEET);

  eq("twenty-five college and thirty-two NFL",
    [r.college.ranked.length, r.nfl.ranked.length], [25, 32]);
  eq("and no honourable mentions, because nothing ran past the end",
    [r.college.honorable.length, r.nfl.honorable.length], [0, 0]);
  eq("nothing was left unread", r.ignored.length, 0);

  eq("the header decides which column is which board",
    [r.college.ranked[0].team, r.nfl.ranked[0].team], ["Georgia", "San Francisco 49ers"]);
  eq("ranks are in order", r.nfl.ranked.map((e) => e.rank).join(","),
    Array.from({ length: 32 }, (_, i) => i + 1).join(","));

  // The rows where only one board has a team. The college column is empty from
  // twenty-six on, and the NFL club must not slide into its place.
  eq("an empty college cell does not shift the NFL column",
    r.nfl.ranked[31].team, "Miami Dolphins");
  eq("and college stops where it stops", r.college.ranked[24].team, "Auburn");
  eq("the thirty-second NFL club keeps its rank", r.nfl.ranked[31].rank, 32);

  eq("records come through", r.nfl.ranked[0].record, "1-0");
  eq("and a rank Excel wrote as 1.0 is still 1", r.college.ranked[0].rank, 1);

  // Excel reads "2-0" as a date and hands back a serial. Printing 46023 beside
  // Ohio State would be worse than printing nothing.
  eq("a record Excel turned into a date is dropped", r.college.ranked[3].record, "");
  ok("rather than shown as a number",
    !JSON.stringify(r).includes("46023"));

  eq("a trailing space is not part of a name",
    r.nfl.ranked[13].team.endsWith(" "), false);
  eq("nothing was left unread", r.ignored, []);
}

console.log("\n--- where each board's ranking ends ---");
{
  // The boards are different depths, so the same rank number means different
  // things on each: twenty-six is past the end of a college top twenty-five
  // and comfortably inside an NFL thirty-two.
  const r = parseRankings(
    [
      "College Football\t\t\tNFL\t",
      "25\tAuburn\t2-0\tArizona Cardinals\t1-0",
      "26\tKansas State\t2-0\tCleveland Browns\t1-0",
      "32\t\t\tMiami Dolphins\t0-1",
      "33\t\t\tOakland Raiders\t0-1",
    ].join("\n"),
  );

  eq("twenty-five is the last college rank", r.college.ranked.map((e) => e.team), ["Auburn"]);
  eq("twenty-six is a college honourable mention",
    r.college.honorable.map((e) => e.team), ["Kansas State"]);

  eq("but twenty-six is a ranked NFL club",
    r.nfl.ranked.map((e) => e.team), ["Arizona Cardinals", "Cleveland Browns", "Miami Dolphins"]);
  eq("and thirty-three is past the end of even that",
    r.nfl.honorable.map((e) => e.team), ["Oakland Raiders"]);
}

console.log("\n--- half the sheet ---");
{
  // Pasting one board is a rank and one pair. Without a header there is no way
  // to know which board it is, so it goes to the first column's — which is
  // where the caller looks for it.
  const one = parseRankings("1\tGeorgia\t2-0\n2\tMiami\t2-0");
  eq("one pair is one board", [one.college.ranked.length, one.nfl.ranked.length], [2, 0]);

  const named = parseRankings("NFL\n1\tBaltimore Ravens\t1-0");
  eq("and a header says which", [named.college.ranked.length, named.nfl.ranked.length], [0, 1]);
}

console.log("\n--- and a paste that is not a grid ---");
{
  // A title and a stray note. Neither carries a rank and neither names a
  // board, so both are handed back — a paste that quietly drops a line is how
  // a ranking ends up missing its eighth team.
  const junk = parseRankings("Power rankings going into week 2\n\nsome notes I typed");
  eq("unreadable lines are handed back rather than dropped", junk.ignored.length, 2);
  ok("with the line itself, so it can be shown",
    junk.ignored.some((l) => /some notes/.test(l)));

  // But a line that does name a board is a header, not a failure.
  const titled = parseRankings("NFL power rankings, week 2\n1\tBaltimore Ravens\t1-0");
  eq("a titled board is read as one", [titled.nfl.ranked.length, titled.ignored.length], [1, 0]);
}

console.log("\n--- the write-up ---");
{
  const DOC = [
    "NFL Post Week 1 Report",
    "",
    "San Francisco 49ers - Kyle Shanahan is still Kyle Shanahan, Brock Purdy played one of his best games.",
    "",
    "Baltimore Ravens - Lamar Jackson looked great coming off a hobbled 2025 campaign.",
    "Derrick Henry has not slowed down either.",
    "",
    "Cincinnati Bengals - The Bengals defense looked good?",
  ].join("\n");

  const b = parseBreakdowns(DOC);
  eq("one paragraph is one team", b.nfl.length, 3);
  eq("the team is the part before the dash", b.nfl[0].team, "San Francisco 49ers");
  ok(`and the breakdown is the rest (${b.nfl[0].note.slice(0, 40)})`,
    /Kyle Shanahan is still/.test(b.nfl[0].note));

  // A paragraph that wraps belongs to the team above it, not to nobody.
  ok(`a wrapped paragraph is not lost (${b.nfl[1].note.slice(-30)})`,
    /Derrick Henry has not slowed down/.test(b.nfl[1].note));

  // The title has no separator in it, so it is never mistaken for a team.
  ok("the document's title is not a team",
    !b.nfl.some((x) => /Post Week 1 Report/.test(x.team)));

  const two = parseBreakdowns("College Football\nGeorgia - They were fine.\nNFL\nBaltimore Ravens - So were they.");
  eq("a heading switches board", [two.college.length, two.nfl.length], [1, 1]);
}

console.log("\n--- joining the two ---");
{
  const r = parseRankings(SHEET);
  const b = parseBreakdowns(
    [
      "Baltimore Ravens - Lamar Jackson looked great.",
      "green bay packers - A concerning loss.",
      "Cincinnati Bengals - The defense looked good?",
      "Oakland Raiders - A write-up under a name the board does not use.",
    ].join("\n"),
  );

  const joined = joinBreakdowns(r.nfl, b.nfl);
  const noteOf = (team: string) =>
    [...joined.board.ranked, ...joined.board.honorable].find((e) => e.team === team)?.note ?? "";

  ok(`the write-up lands on the team (${noteOf("Baltimore Ravens").slice(0, 30)})`,
    /Lamar Jackson looked great/.test(noteOf("Baltimore Ravens")));

  // The sheet has a trailing space and the write-up is in lower case. Both are
  // the same team, and a join that cared would lose the paragraph.
  // The sheet had a trailing space on the name and the write-up is in lower
  // case. Both are the same team, and a join that cared about either would
  // lose the paragraph.
  ok("case and stray spaces do not break the join",
    /concerning loss/.test(noteOf("Green Bay Packers")));

  // The sheet spells it "Cincinatti" and the write-up spells it "Cincinnati".
  // That is a real difference and this does not pretend otherwise — it says so.
  eq("a genuine misspelling does not silently match", noteOf("Cincinatti Bengals"), "");
  ok(`and is reported rather than swallowed (${joined.unmatched.join(", ")})`,
    joined.unmatched.includes("Cincinnati Bengals") &&
      joined.unmatched.includes("Oakland Raiders"));

  eq("a matched write-up is not reported as missing",
    joined.unmatched.includes("Baltimore Ravens"), false);
}

console.log("\n--- the arrows ---");
{
  const before = parseRankings(SHEET);
  const after = parseRankings(
    [
      "NFL",
      "1\tBaltimore Ravens\t2-0",       // was 7
      "2\tSan Francisco 49ers\t2-0",    // was 1
      "3\tChicago Bears\t1-1",          // was 2
      "4\tNew York Jets\t2-0",          // was 20
      "5\tLas Vegas Raiders\t2-0",      // was 23
      ...Array.from({ length: 10 }, (_, i) => `${i + 6}\tTeam ${i}\t1-1`),
      "16\tKansas City Chiefs\t1-1",    // was 3
      ...Array.from({ length: 4 }, (_, i) => `${i + 17}\tOther ${i}\t0-2`),
    ].join("\n"),
  );

  const m = movement(after.nfl, before.nfl);
  const at = (team: string) => moveLabel(m.get(keyOf(team)));

  eq("a climb counts the places", at("Baltimore Ravens"), "Up 6 places");
  eq("and a fall counts them too", at("San Francisco 49ers"), "Down 1 place");
  eq("one place is singular", at("Chicago Bears"), "Down 1 place");

  // The far end of the board is part of the same ladder. A club that was 20th
  // and is now 4th moved sixteen places; calling it NEW throws that away.
  eq("a climb from the bottom of the board has moved, not arrived",
    at("New York Jets"), "Up 16 places");
  eq("and a fall down it is a fall",
    at("Kansas City Chiefs"), "Down 13 places");

  // Nobody can be new to a board that already holds all thirty-two clubs, so
  // the case is tested where it is real: college ranks twenty-five out of a
  // hundred and thirty, and a team can genuinely arrive from nowhere.
  const collegeAfter = parseRankings(
    ["College Football", "1\tKansas State\t3-0", "2\tGeorgia\t3-0"].join("\n"),
  );
  const cm = movement(collegeAfter.college, before.college);
  eq("somebody who was nowhere is new",
    moveLabel(cm.get(keyOf("Kansas State"))), "New this week");
  eq("and somebody who was there is not",
    moveLabel(cm.get(keyOf("Georgia"))), "Down 1 place");

  // The first report of a season has nothing to move against. Twenty NEW
  // badges says nothing and reads as a bug.
  eq("and with no week before it, nothing is marked at all",
    movement(after.nfl, null).size, 0);
}

console.log("\n--- what the office is told before it publishes ---");
{
  const r = parseRankings(SHEET);
  const s = summarise(r, ["Cincinnati Bengals"]);
  ok(`it counts both boards (${s})`, /College 25\+0/.test(s) && /NFL 32\+0/.test(s));
  ok("and names the trouble", /1 write-ups unmatched/.test(s));
  ok("a clean paste says nothing about trouble", !/unmatched|unread/.test(summarise(r)));
}

console.log("\n--- records ---");
{
  eq("a record is two numbers and a dash", readRecord("2-0"), "2-0");
  eq("three for a tie", readRecord("1-1-1"), "1-1-1");
  eq("a date serial is not a record", readRecord("46023.0"), "");
  eq("nor is a date", readRecord("10/2/2026"), "");
  eq("nor an empty cell", readRecord(""), "");
  eq("and spacing does not matter", readRecord("  3-1 "), "3-1");
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
