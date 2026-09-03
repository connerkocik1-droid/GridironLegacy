/**
 * Scores a real NFL week with the league's own code and prints its working.
 *
 *   npm run verify-scoring              # whatever is on right now
 *   npm run verify-scoring -- --pre 3   # preseason week 3
 *   npm run verify-scoring -- 5         # regular season week 5
 *   npm run verify-scoring -- 5 --year 2025
 *
 * verify-espn.mjs checks that ESPN still *shapes* its responses the way this
 * app reads them. This is the other half, and the one that answers the
 * question actually worth asking on a Sunday: given a real game, does the
 * arithmetic produce the right number of fantasy points?
 *
 * It runs the production path — the same fetchGameDetail, the same team-sheet
 * position lookup, the same scoreGameDetail the live refresh uses — so what it
 * prints is what the league will see, not a reimplementation that could agree
 * with itself while both are wrong. Open ESPN's own box score beside it and the
 * two should say the same thing.
 *
 * Nothing here writes anything. It reads ESPN and prints.
 *
 * Must be run from a network that can reach ESPN. The Vercel deployment can;
 * a sandbox behind a proxy that blocks espn.com cannot, and will say so.
 */

import {
  fetchGameDetail,
  fetchPlayByPlay,
  fetchScoreboard,
  withTeamPositions,
  type Game,
  type SeasonType,
} from "../src/lib/espn.ts";
import {
  formatStatLine,
  scoreGameDetail,
  toSlotPosition,
  type ScoringFormat,
} from "../src/lib/scoring.ts";
import { player as pooledPlayer } from "../src/lib/roster.ts";

const SEASON_NAME: Record<number, string> = {
  1: "preseason",
  2: "regular season",
  3: "postseason",
};

// The league's own rules. Named here rather than read from the database so
// this runs against any deployment, or none.
const FORMAT: ScoringFormat = "half";

// ------------------------------------------------------------------ arguments

const argv = process.argv.slice(2);
let seasonType: SeasonType | null = null;
let week: number | undefined;
let year: number | undefined;
let plays = false;

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--pre") seasonType = 1;
  else if (arg === "--reg") seasonType = 2;
  else if (arg === "--post") seasonType = 3;
  else if (arg === "--plays") plays = true;
  else if (arg === "--year") year = Number(argv[++i]);
  else if (/^\d+$/.test(arg)) week = Number(arg);
  else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}
if (week != null && seasonType == null) seasonType = 2;

// ----------------------------------------------------------------- the week

const asked = seasonType == null ? "whatever is on now" : SEASON_NAME[seasonType];
console.log(`asking for ${asked}${week != null ? `, week ${week}` : ""}${year ? `, ${year}` : ""}\n`);

let games: Game[];
try {
  games = await fetchScoreboard(week, seasonType, year);
} catch (err) {
  console.error("Could not reach ESPN.");
  console.error(`  ${(err as Error).message}`);
  console.error("\nA proxy or network policy that blocks espn.com will do this.");
  process.exit(1);
}

const played = games.filter((g) => g.state !== "pre");
console.log(`${games.length} games, ${played.length} of them started`);

if (!played.length) {
  console.log("\nNothing has kicked off. Try a week that has been played.");
  process.exit(0);
}

// One game is enough to check the arithmetic and costs one request rather than
// thirteen. The last one to have finished is the fullest.
const game = played.find((g) => g.state === "post") ?? played[0];
console.log(
  `\nscoring ${game.away?.abbrev} ${game.away?.score} @ ${game.home?.abbrev} ${game.home?.score}` +
    `  (event ${game.id}, ${game.statusDetail})\n`,
);

const detail = await fetchGameDetail(game.id);
const stats = await withTeamPositions(detail.stats);

// ------------------------------------------------------------- the positions

// The whole point of reading the club team sheet: nothing should be left
// without a position, because a stat line is written in the vocabulary of one.
const byPlayer = new Map<string, string | undefined>();
for (const stat of stats) {
  if (!byPlayer.has(stat.name) || (!byPlayer.get(stat.name) && stat.position)) {
    byPlayer.set(stat.name, stat.position);
  }
}

const unplaced = [...byPlayer].filter(([, position]) => !position).map(([name]) => name);
console.log(`positions: ${byPlayer.size - unplaced.length} of ${byPlayer.size} named by ESPN`);
if (unplaced.length) {
  console.log(`  not stated: ${unplaced.slice(0, 12).join(", ")}${unplaced.length > 12 ? "…" : ""}`);
  console.log("  (these fall back to the draft pool, and to a blank past that)");
}

// -------------------------------------------------------------- the scoring

const scored = scoreGameDetail(
  { ...detail, stats },
  [
    { abbrev: game.home?.abbrev ?? "", score: game.home?.score ?? 0 },
    { abbrev: game.away?.abbrev ?? "", score: game.away?.score ?? 0 },
  ],
  FORMAT,
);

const rows = [...scored.players]
  .filter((p) => p.points !== 0 || p.statLine)
  .sort((a, b) => b.points - a.points);

console.log(`\n${rows.length} players scored. Hold this against ESPN's own box score:\n`);
console.log(`  ${"PTS".padStart(6)}  ${"POS".padEnd(5)} ${"PLAYER".padEnd(26)} LINE`);
console.log(`  ${"-".repeat(6)}  ${"-".repeat(5)} ${"-".repeat(26)} ${"-".repeat(40)}`);

for (const row of rows) {
  // The same order the app uses: the roster knows best, ESPN's team sheet
  // answers for anybody it does not.
  const position =
    pooledPlayer(row.name)?.p ?? toSlotPosition(row.line?.position ?? "") ?? "";
  const line = row.line ? formatStatLine(row.line, position) : row.statLine;

  console.log(
    `  ${row.points.toFixed(1).padStart(6)}  ${(position || "—").padEnd(5)} ` +
      `${row.name.slice(0, 26).padEnd(26)} ${line}`,
  );
}

// ------------------------------------------------------------- the play feed

if (plays) {
  console.log("\nplay by play (core API — the drive feed, not the scorer):");
  const feed = await fetchPlayByPlay(game.id);

  if (!feed.length) {
    console.log("  nothing returned. The core API may have moved, or the game has no plays yet.");
  } else {
    console.log(`  ${feed.length} plays, ${feed.filter((p) => p.scoring).length} of them scoring`);
    for (const play of feed.filter((p) => p.scoring).slice(0, 8)) {
      console.log(`    Q${play.period} ${play.clock.padStart(5)}  ${play.text.slice(0, 90)}`);
    }
  }
}

console.log(
  "\nIf a number here disagrees with ESPN, the bug is in src/lib/scoring.ts and" +
    "\nthe stat line above says which rule produced it.",
);
