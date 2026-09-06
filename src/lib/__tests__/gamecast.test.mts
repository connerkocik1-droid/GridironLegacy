import { boxscore, gamecast, type Ownership } from "../gamecast";
import type { Play, PlayerStat, ScoringPlay } from "../espn";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}`}`);
  if (!pass) failed++;
};

const stat = (
  name: string,
  team: string,
  group: string,
  stats: Record<string, string>,
  position?: string,
): PlayerStat => ({ name, team, group, stats, position });

const play = (id: string, period: number, clock: string, text: string, scoring = false): Play => ({
  id,
  sequence: id.padStart(6, "0"),
  type: scoring ? "Touchdown" : "Rush",
  text,
  period,
  clock,
  teamId: "1",
  scoring,
  homeScore: 0,
  awayScore: 0,
});

const owners = (pairs: [string, string, string][]): Ownership => ({
  byPlayer: new Map(pairs.map(([name, franchise, managerId]) => [name, { franchise, managerId }])),
});

// A back with a touchdown, a receiver with a quiet day, and a name spelled
// differently by ESPN than by the league.
const STATS: PlayerStat[] = [
  stat("Jahmyr Gibbs", "DET", "rushing", { CAR: "14", YDS: "92", TD: "1" }, "RB"),
  stat("Jahmyr Gibbs", "DET", "receiving", { REC: "3", YDS: "21", TD: "0" }, "RB"),
  stat("Amon-Ra St. Brown", "DET", "receiving", { REC: "7", YDS: "84", TD: "0" }, "WR"),
  stat("Sam LaPorta", "DET", "receiving", { REC: "2", YDS: "16", TD: "0" }, "TE"),
];

const SCORING: ScoringPlay[] = [
  { type: "TD", team: "DET", text: "Jahmyr Gibbs 12 Yd Run (Jake Bates Kick)", value: 7 },
];

console.log("\n--- who is owned, and by whom ---");
{
  const g = gamecast(
    STATS,
    SCORING,
    [],
    owners([
      ["Jahmyr Gibbs", "Steel Cartel", "m0"],
      ["Sam LaPorta", "Gold Coast Gladiators", "m7"],
    ]),
    "ppr",
  );

  eq("only rostered players are owned", g.owned.map((p) => p.name), ["Jahmyr Gibbs", "Sam LaPorta"]);
  eq("best afternoon first", g.owned[0].name, "Jahmyr Gibbs");
  eq("with the franchise holding him", g.owned[0].franchise, "Steel Cartel");
  eq("and the manager, so a browser can mark its own", g.owned[0].managerId, "m0");
  eq("a free agent has no franchise", g.notable[0].franchise, null);
  eq("the best unowned player is named", g.notable[0].name, "Amon-Ra St. Brown");
  eq("and an owned one is never in that list", g.notable.some((p) => p.franchise), false);
}

console.log("\n--- the league's spelling wins ---");
{
  // ESPN and the league disagree about the punctuation; the roster page says
  // one thing and this must not say another.
  const g = gamecast(
    [stat("Amon-Ra St Brown", "DET", "receiving", { REC: "7", YDS: "84" }, "WR")],
    [],
    [],
    owners([["Amon-Ra St. Brown", "Iron Rail", "m9"]]),
    "ppr",
  );
  eq("shown as the league spells him", g.owned.map((p) => p.name), ["Amon-Ra St. Brown"]);
}

console.log("\n--- the scoring format is the league's ---");
{
  const ppr = gamecast(STATS, [], [], owners([["Jahmyr Gibbs", "A", "m0"]]), "ppr");
  const std = gamecast(STATS, [], [], owners([["Jahmyr Gibbs", "A", "m0"]]), "standard");
  // Three receptions are three points in full PPR and none in standard.
  eq("full PPR pays for the catches", ppr.owned[0].points - std.owned[0].points, 3);
}

console.log("\n--- a player nobody owns and nobody scored ---");
{
  const g = gamecast(
    [stat("Some Guy", "DET", "rushing", { CAR: "1", YDS: "0" }, "RB")],
    [],
    [],
    owners([]),
    "ppr",
  );
  eq("nought points is not notable", g.notable, []);
  eq("and nobody is owned", g.owned, []);
}

console.log("\n--- the play feed ---");
{
  const many = Array.from({ length: 80 }, (_, i) => play(String(i + 1), 1, "10:00", `Play ${i + 1}`));
  const g = gamecast([], [], many, owners([]), "ppr");
  eq("trimmed to the last sixty", g.plays.length, 60);
  eq("newest first", g.plays[0].text, "Play 80");
  eq("and the oldest kept is the twenty-first", g.plays[59].text, "Play 21");
}
{
  const g = gamecast([], [], [play("1", 2, "0:04", "Gibbs 12 Yd Run", true)], owners([]), "ppr");
  eq("a scoring play says so", g.plays[0].scoring, true);
  eq("with its quarter and clock", [g.plays[0].period, g.plays[0].clock], [2, "0:04"]);
}

console.log("\n--- nothing has happened yet ---");
{
  const g = gamecast([], [], [], owners([["Jahmyr Gibbs", "A", "m0"]]), "ppr");
  eq("an empty box score is empty, not an error", [g.owned, g.notable, g.plays], [[], [], []]);
}

console.log("\n--- the box score ---");
{
  const box = boxscore([
    stat("Jared Goff", "DET", "passing", { "C/ATT": "22/30", YDS: "241", TD: "2", INT: "0" }),
    stat("Jahmyr Gibbs", "DET", "rushing", { CAR: "14", YDS: "92", TD: "1" }),
    stat("David Montgomery", "DET", "rushing", { CAR: "9", YDS: "34", TD: "0" }),
    stat("Jordan Love", "GB", "passing", { "C/ATT": "18/31", YDS: "199", TD: "1", INT: "1" }),
  ]);

  eq("both teams, in the order they appeared", box.map((t) => t.team), ["DET", "GB"]);
  eq("Detroit's groups", box[0].groups.map((g) => g.group), ["passing", "rushing"]);
  eq("ESPN's own columns, in ESPN's own order",
    box[0].groups[0].labels, ["C/ATT", "YDS", "TD", "INT"]);
  eq("a line reads across", box[0].groups[0].rows[0], { name: "Jared Goff", values: ["22/30", "241", "2", "0"] });
  eq("everybody in the group is there", box[0].groups[1].rows.map((r) => r.name),
    ["Jahmyr Gibbs", "David Montgomery"]);
  eq("and the other team is its own", box[1].groups[0].rows[0].values, ["18/31", "199", "1", "1"]);
}
{
  // A column that turns up late must widen the whole group, not truncate the
  // rows above it — and the player who never had it says so rather than
  // shifting everybody's numbers one to the left.
  const box = boxscore([
    stat("A", "DET", "rushing", { CAR: "3", YDS: "9" }),
    stat("B", "DET", "rushing", { CAR: "1", YDS: "4", TD: "1" }),
  ]);
  eq("a late column widens the group", box[0].groups[0].labels, ["CAR", "YDS", "TD"]);
  eq("and the row that lacks it is padded, not shifted",
    box[0].groups[0].rows.map((r) => r.values), [["3", "9", "—"], ["1", "4", "1"]]);
}
{
  eq("no box score is no teams", boxscore([]), []);
  eq("a player with no team is not a row",
    boxscore([stat("Nobody", "", "rushing", { CAR: "1" })]), []);
}
{
  const g = gamecast(STATS, [], [], owners([]), "ppr");
  eq("the gamecast carries it", g.box.length > 0, true);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exit(1);
