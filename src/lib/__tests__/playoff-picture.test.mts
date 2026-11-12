import { bracketShape, firstRound, playoffPicture, roundName, type PictureTeam } from "../playoff-picture";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!pass) failed++;
};

console.log("--- the shape of the bracket ---");
eq("six teams: three rounds, the top two sit out the first", bracketShape(6), { field: 6, rounds: 3, byes: 2 });
eq("four teams: two rounds, no byes", bracketShape(4), { field: 4, rounds: 2, byes: 0 });
eq("six teams open 3 v 6 and 4 v 5", firstRound(bracketShape(6)), [[3, 6], [4, 5]]);
eq("four open 1 v 4 and 2 v 3", firstRound(bracketShape(4)), [[1, 4], [2, 3]]);
eq("rounds are named from the end", [1, 2, 3].map((r) => roundName(r, 3)), ["Wild card", "Semi-finals", "Championship"]);
eq("so a two-round bracket starts at the semi-finals", [1, 2].map((r) => roundName(r, 2)), ["Semi-finals", "Championship"]);

// The league as it stood after week nine: two divisions of five, a six-team
// field, five weeks left.
const SOUTH = ["ORBT", "BLZ", "NOVA", "ONYX", "APEX"];
const team = (id: string, wins: number, losses: number, remaining: number): PictureTeam => ({
  id, division: SOUTH.includes(id) ? "South" : "North", wins, losses, ties: 0, remaining,
});
const table = (records: Record<string, [number, number]>, remaining: number) =>
  Object.entries(records).map(([id, [w, l]]) => team(id, w, l, remaining));
const statuses = (rows: { id: string; mark: string | null }[]) => Object.fromEntries(rows.map((r) => [r.id, r.mark ?? "-"]));

console.log("\n--- five weeks left ---");
{
  const order = ["ORBT", "FLUX", "BLZ", "TITN", "HELX", "NOVA", "RVN", "ONYX", "STL", "APEX"];
  const { rows } = playoffPicture(
    table({ ORBT: [7, 2], FLUX: [7, 2], BLZ: [7, 2], TITN: [5, 4], HELX: [5, 4], NOVA: [4, 5], RVN: [4, 5], ONYX: [3, 6], STL: [2, 7], APEX: [1, 8] }, 5),
    order, 6);
  eq("nobody is safe and nobody is out yet", rows.every((r) => r.mark === null), true);
  eq("the top two would have the byes", rows.filter((r) => r.bye).map((r) => r.id), ["ORBT", "FLUX"]);
  eq("six in, four out", rows.filter((r) => r.inField).length, 6);
  eq("the division leaders are marked", rows.filter((r) => r.divisionLeader).map((r) => r.id), ["ORBT", "FLUX"]);
  eq("and those outside say how far behind the last one in", rows.filter((r) => !r.inField).map((r) => [r.id, r.behind]),
    [["RVN", 0], ["ONYX", 1], ["STL", 2], ["APEX", 3]]);
}

console.log("\n--- one week left ---");
{
  const order = ["ORBT", "FLUX", "BLZ", "TITN", "HELX", "NOVA", "RVN", "STL", "ONYX", "APEX"];
  const { rows } = playoffPicture(
    table({ ORBT: [11, 2], FLUX: [10, 3], BLZ: [9, 4], TITN: [8, 5], HELX: [8, 5], NOVA: [7, 6], RVN: [6, 7], STL: [5, 8], ONYX: [4, 9], APEX: [2, 11] }, 1),
    order, 6);
  eq("byes, divisions, places and the eliminated, each certain", statuses(rows), {
    ORBT: "z", FLUX: "z", BLZ: "x", TITN: "x", HELX: "x", NOVA: "-", RVN: "-", STL: "e", ONYX: "e", APEX: "e",
  });
  eq("the last seed in is still playing for it", rows.find((r) => r.id === "NOVA")?.status, "in");
  eq("and the first one out can still catch them", rows.find((r) => r.id === "RVN")?.status, "out");
}

console.log("\n--- level on wins is not safe ---");
{
  // Two level at the top of a division with a week left: neither has the
  // division, because points could still split them either way.
  const order = ["ORBT", "FLUX", "BLZ", "TITN", "HELX", "NOVA", "RVN", "STL", "ONYX", "APEX"];
  const { rows } = playoffPicture(
    table({ ORBT: [10, 3], BLZ: [9, 4], FLUX: [10, 3], TITN: [5, 8], HELX: [5, 8], NOVA: [5, 8], RVN: [5, 8], STL: [5, 8], ONYX: [4, 9], APEX: [2, 11] }, 1),
    order, 6);
  eq("a rival a win behind with a game left keeps the division open", rows.find((r) => r.id === "ORBT")?.mark, "x");
}

console.log("\n--- the season over ---");
{
  const order = ["ORBT", "FLUX", "BLZ", "TITN", "HELX", "NOVA", "RVN", "ONYX", "STL", "APEX"];
  const { rows } = playoffPicture(
    table({ ORBT: [10, 4], FLUX: [10, 4], BLZ: [10, 4], TITN: [8, 6], HELX: [8, 6], NOVA: [7, 7], RVN: [7, 7], ONYX: [5, 9], STL: [4, 10], APEX: [1, 13] }, 0),
    order, 6);
  // Level records are settled by the tiebreak the order already applied.
  eq("with nothing left the order is final", statuses(rows), {
    ORBT: "z", FLUX: "z", BLZ: "x", TITN: "x", HELX: "x", NOVA: "x", RVN: "e", ONYX: "e", STL: "e", APEX: "e",
  });
}

console.log("\n--- a small league ---");
eq("a field larger than the league is the league", playoffPicture(table({ ORBT: [1, 0], FLUX: [0, 1] }, 2), ["ORBT", "FLUX"], 6).shape, { field: 2, rounds: 1, byes: 0 });

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
