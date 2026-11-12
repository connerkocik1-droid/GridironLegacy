import { bracketLayout, bracketOrder, type BracketGameIn, type BracketTeam } from "../bracket-layout";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!pass) failed++;
};

const TEAMS: BracketTeam[] = ["ORBT", "FLUX", "BLZ", "TITN", "HELX", "NOVA"].map((abbr, i) => ({
  id: abbr.toLowerCase(), seed: i + 1, abbr, franchise: abbr,
}));
const show = (layout: ReturnType<typeof bracketLayout>) =>
  layout.columns.map((c) => c.boxes.map((b) => (b.bye ? `bye:${b.lines[0].team?.seed}` : b.lines.map((l) => l.team?.seed ?? "?").join("v"))).join(" "));

console.log("--- the order ---");
eq("eight lines in standard order", bracketOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
eq("four", bracketOrder(4), [1, 4, 2, 3]);

console.log("\n--- nothing played ---");
{
  const layout = bracketLayout({ teams: TEAMS, games: [], roundWeeks: [15, 16, 17] });
  eq("six: byes for 1 and 2, then 4 v 5 and 3 v 6; the rested in the semi-finals, the rest TBD", show(layout),
    ["bye:1 4v5 bye:2 3v6", "1v? 2v?", "?v?"]);
  eq("columns named from the end, with their weeks", layout.columns.map((c) => `${c.title}@${c.week}`),
    ["Wild card@15", "Semi-finals@16", "Championship@17"]);
  eq("and no champion", layout.champion, null);
}

const game = (id: string, round: number, week: number, home: string, away: string, final: boolean, winner: string | null, hp = 0, ap = 0): BracketGameIn =>
  ({ id, round, week, final, winner, home: { id: home, points: hp }, away: { id: away, points: ap } });

console.log("\n--- the wild card played, with an upset ---");
{
  const games = [
    game("a", 1, 15, "titn", "helx", true, "titn", 110, 100),
    game("b", 1, 15, "blz", "nova", true, "nova", 90, 120),
    // Reseeded: 1 plays the lowest left (6), 2 plays 4.
    game("c", 2, 16, "orbt", "nova", false, null),
    game("d", 2, 16, "flux", "titn", false, null),
  ];
  const layout = bracketLayout({ teams: TEAMS, games });
  eq("the semi-finals as drawn, each level with its top team", show(layout), ["bye:1 4v5 bye:2 3v6", "1v6 2v4", "?v?"]);
  eq("the winner and loser are marked", layout.columns[0].boxes[3].lines.map((l) => [l.team?.abbr, l.won, l.lost]),
    [["BLZ", false, true], ["NOVA", true, false]]);
}

console.log("\n--- the whole thing ---");
{
  const games = [
    game("a", 1, 15, "titn", "helx", true, "titn"),
    game("b", 1, 15, "blz", "nova", true, "blz"),
    game("c", 2, 16, "orbt", "titn", true, "orbt"),
    game("d", 2, 16, "flux", "blz", true, "blz"),
    game("e", 3, 17, "orbt", "blz", true, "blz"),
  ];
  const layout = bracketLayout({ teams: TEAMS, games });
  eq("every round filled in", show(layout), ["bye:1 4v5 bye:2 3v6", "1v4 2v3", "1v3"]);
  eq("the final's winner is the champion", layout.champion?.abbr, "BLZ");
}

console.log("\n--- four teams, no byes ---");
eq("1 v 4 and 2 v 3", show(bracketLayout({ teams: TEAMS.slice(0, 4), games: [] })), ["1v4 2v3", "?v?"]);

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
