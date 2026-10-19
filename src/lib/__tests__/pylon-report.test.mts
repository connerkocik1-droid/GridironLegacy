import { keyOf, moveLabel, movement, parsePolls, type BoardReport } from "../pylon-report";

let failed = 0;
const ok = (label: string, cond: boolean) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failed++;
};
const eq = (label: string, got: unknown, want: unknown) =>
  ok(`${label} — got ${JSON.stringify(got)}`, JSON.stringify(got) === JSON.stringify(want));

const board = (teams: { team: string; rank: number; record?: string }[]): BoardReport => ({
  ranked: teams.map((t) => ({ rank: t.rank, team: t.team, record: t.record ?? "" })),
  honorable: [],
});

console.log("--- the arrows ---");
{
  const before = board([
    { rank: 1, team: "San Francisco 49ers" },
    { rank: 2, team: "Chicago Bears" },
    { rank: 3, team: "Kansas City Chiefs" },
    { rank: 7, team: "Baltimore Ravens" },
    { rank: 20, team: "New York Jets" },
    { rank: 23, team: "Las Vegas Raiders" },
  ]);
  const after = board([
    { rank: 1, team: "Baltimore Ravens" }, // was 7
    { rank: 2, team: "San Francisco 49ers" }, // was 1
    { rank: 3, team: "Chicago Bears" }, // was 2
    { rank: 4, team: "New York Jets" }, // was 20
    { rank: 5, team: "Las Vegas Raiders" }, // was 23
    { rank: 16, team: "Kansas City Chiefs" }, // was 3
  ]);

  const m = movement(after, before);
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

  const collegeBefore = board([{ rank: 1, team: "Georgia" }]);
  const collegeAfter = board([
    { rank: 1, team: "Kansas State" },
    { rank: 2, team: "Georgia" },
  ]);
  const cm = movement(collegeAfter, collegeBefore);
  eq("somebody who was nowhere is new",
    moveLabel(cm.get(keyOf("Kansas State"))), "New this week");
  eq("and somebody who was there is not",
    moveLabel(cm.get(keyOf("Georgia"))), "Down 1 place");

  // Case and stray spaces should not break the match.
  const spaced = board([{ rank: 1, team: "green bay packers " }]);
  const spacedAfter = board([{ rank: 2, team: "Green Bay Packers" }]);
  eq("case and stray spaces do not break the join",
    moveLabel(movement(spacedAfter, spaced).get(keyOf("Green Bay Packers"))), "Down 1 place");

  // The first report of a season has nothing to move against. Twenty NEW
  // badges says nothing and reads as a bug.
  eq("and with no week before it, nothing is marked at all",
    movement(after, null).size, 0);
}

console.log("\n--- the national polls ---");
{
  const SHEET = [
    "AP\tCoaches\tCFP",
    "1\tOhio State\tOhio State\tGeorgia",
    "2.0\tGeorgia\tTexas\tOhio State",
    "3\tTexas\tGeorgia\tTexas",
  ].join("\n");

  const { polls, ignored } = parsePolls(SHEET);
  eq("a header assigns each column to its poll",
    [polls.ap[0].team, polls.coaches[0].team, polls.cfp[0].team],
    ["Ohio State", "Ohio State", "Georgia"]);
  eq("and a rank Excel wrote as 2.0 is still 2", polls.ap[1].rank, 2);
  eq("ranks share down the row",
    polls.coaches.map((e) => e.rank), [1, 2, 3]);
  eq("nothing was left unread", ignored, []);

  const noHeader = parsePolls("1\tAlabama\tAlabama\tAlabama");
  eq("without a header the default order is AP, Coaches, CFP",
    [noHeader.polls.ap[0].team, noHeader.polls.coaches[0].team, noHeader.polls.cfp[0].team],
    ["Alabama", "Alabama", "Alabama"]);

  const junk = parsePolls("Rankings going into week 8\n\n26\tTeam that doesn't count");
  eq("a rank past 25 and a title are both unread", junk.ignored.length, 2);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
