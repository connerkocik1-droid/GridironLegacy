/**
 * Checks the assumptions src/lib/espn.ts and src/lib/scoring.ts make about
 * ESPN's undocumented endpoints. Run it from a network that can reach ESPN:
 *
 *   node scripts/verify-espn.mjs                 # whatever is on right now
 *   node scripts/verify-espn.mjs --pre           # the current preseason week
 *   node scripts/verify-espn.mjs --pre 3         # preseason week 3
 *   node scripts/verify-espn.mjs 5               # regular season week 5
 *   node scripts/verify-espn.mjs --post 1        # wild card round
 *   node scripts/verify-espn.mjs --pre 3 --year 2025
 *
 * It checks two things. First that the scoreboard still carries the fields
 * espn.ts reads, which is all the score ticker needs. Then that the box score
 * still labels its columns the way scoring.ts expects — every required label
 * must appear, and anything reported MISSING means ESPN has changed shape.
 *
 * Preseason box scores are thin: starters play a series and the stat groups
 * are the same ones, so it is a fair check of the shape even though the
 * numbers are meaningless for fantasy.
 */

// Overridable so the parser can be exercised against a recorded response.
// Unset everywhere except a test harness, which is where it belongs.
const SITE =
  process.env.ESPN_API_BASE ?? "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

// Labels scoring.ts depends on, by ESPN stat group.
const REQUIRED = {
  passing: ["YDS", "TD", "INT", "C/ATT"],
  rushing: ["CAR", "YDS", "TD"],
  receiving: ["REC", "YDS", "TD"],
  kicking: ["FG", "XP", "LONG"],
  fumbles: ["LOST"],
};

// Scoreboard fields espn.ts reads off every event.
const EVENT_FIELDS = [
  ["id", (e) => e.id != null],
  ["date", (e) => typeof e.date === "string"],
  ["season.type", (e) => [1, 2, 3].includes(Number(e.season?.type))],
  ["week.number", (e) => Number.isFinite(Number(e.week?.number))],
  ["competitions[0]", (e) => Array.isArray(e.competitions) && e.competitions.length > 0],
  ["status.type.state", (e) =>
    ["pre", "in", "post"].includes(e.competitions?.[0]?.status?.type?.state)],
  ["status.type.completed", (e) =>
    typeof e.competitions?.[0]?.status?.type?.completed === "boolean"],
  ["status.type.shortDetail", (e) =>
    typeof e.competitions?.[0]?.status?.type?.shortDetail === "string"],
  ["two competitors", (e) => (e.competitions?.[0]?.competitors ?? []).length === 2],
  ["team.abbreviation", (e) =>
    (e.competitions?.[0]?.competitors ?? []).every((c) => typeof c.team?.abbreviation === "string")],
  ["competitor.score", (e) =>
    (e.competitions?.[0]?.competitors ?? []).every((c) => c.score != null)],
  ["competitor.homeAway", (e) =>
    ["home", "away"].every((s) =>
      (e.competitions?.[0]?.competitors ?? []).some((c) => c.homeAway === s))],
];

const SEASON_NAME = { 1: "preseason", 2: "regular season", 3: "postseason" };

// ---------------------------------------------------------------- arguments
const argv = process.argv.slice(2);
let seasonType = null;
let week;
let year;

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (arg === "--pre") seasonType = 1;
  else if (arg === "--reg") seasonType = 2;
  else if (arg === "--post") seasonType = 3;
  else if (arg === "--year") year = argv[++i];
  else if (/^\d+$/.test(arg)) week = arg;
  else {
    console.error(`Unknown argument: ${arg}`);
    process.exit(2);
  }
}

// A bare week number has always meant the regular season.
if (week && seasonType == null) seasonType = 2;

const params = new URLSearchParams();
if (week) params.set("week", week);
if (seasonType != null) params.set("seasontype", String(seasonType));
if (year) params.set("dates", year);

/** Fetch, saying plainly what went wrong rather than throwing a parse error. */
async function getJson(url) {
  let res;
  try {
    res = await fetch(url, { headers: { accept: "application/json" } });
  } catch (err) {
    console.error(`\nCould not reach ESPN.\n  ${url}\n  ${err.message}`);
    console.error("\nA proxy or network policy that blocks espn.com will do this.");
    process.exit(1);
  }
  if (!res.ok) {
    console.error(`\nESPN answered ${res.status} for ${url}`);
    process.exit(1);
  }
  try {
    return await res.json();
  } catch {
    console.error(`\nESPN did not return JSON for ${url}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------- scoreboard
const asked = seasonType == null ? "whatever is on now" : SEASON_NAME[seasonType];
console.log(`asking for ${asked}${week ? `, week ${week}` : ""}${year ? `, ${year}` : ""}`);

const board = await getJson(`${SITE}/scoreboard?${params}`);
const events = board.events ?? [];

console.log(`scoreboard: ${events.length} games\n`);
if (!events.length) {
  console.log("No games returned. Try a different week, or --pre during August.");
  process.exit(0);
}

const kinds = new Set(events.map((e) => SEASON_NAME[Number(e.season?.type)] ?? "unknown"));
console.log(`ESPN called these: ${[...kinds].join(", ")}\n`);

for (const e of events.slice(0, 5)) {
  const comp = e.competitions?.[0] ?? {};
  const type = comp.status?.type ?? {};
  // Away first, the way a scoreline is written. Copied rather than sorted in
  // place, so the checks below still see ESPN's own order.
  const rank = (c) => (c.homeAway === "away" ? 0 : 1);
  const teams = [...(comp.competitors ?? [])]
    .sort((a, b) => rank(a) - rank(b))
    .map((c) => `${c.team?.abbreviation} ${c.score}`)
    .join(" @ ");
  console.log(`  ${String(e.id).padEnd(12)} ${teams.padEnd(20)} [${type.state}] ${type.shortDetail ?? ""}`);
}
if (events.length > 5) console.log(`  … and ${events.length - 5} more`);

let bad = 0;
console.log("\nscoreboard fields the ticker reads:");
for (const [name, holds] of EVENT_FIELDS) {
  const failing = events.filter((e) => {
    try { return !holds(e); } catch { return true; }
  });
  if (failing.length) {
    console.log(`  MISSING: ${name} — on ${failing.length} of ${events.length} games`);
    bad++;
  } else {
    console.log(`  ok: ${name}`);
  }
}

// ---------------------------------------------------------------- box score
const sample = events.find((e) => e.competitions?.[0]?.status?.type?.state === "post")
  ?? events.find((e) => e.competitions?.[0]?.status?.type?.state === "in")
  ?? events[0];

console.log(`\nreading box score for event ${sample.id}…`);

const summary = await getJson(`${SITE}/summary?event=${sample.id}`);
const teams = summary.boxscore?.players ?? [];

if (!teams.length) {
  console.log("No box score yet — normal before kickoff. Re-run once a game has been played.");
  process.exit(bad ? 1 : 0);
}

const seen = new Map();
for (const team of teams) {
  for (const group of team.statistics ?? []) {
    if (!seen.has(group.name)) seen.set(group.name, group.labels ?? []);
  }
}

for (const [group, labels] of seen) {
  const need = REQUIRED[group];
  console.log(`\n  ${group}: ${labels.join(", ")}`);
  if (!need) continue;
  for (const label of need) {
    if (!labels.includes(label)) {
      console.log(`    MISSING: ${label} — scoring.ts reads this`);
      bad++;
    }
  }
}

for (const group of Object.keys(REQUIRED)) {
  if (!seen.has(group)) {
    console.log(`\n  MISSING GROUP: ${group}`);
    bad++;
  }
}

console.log(bad ? `\n${bad} thing(s) drifted. Update src/lib/espn.ts or src/lib/scoring.ts.` : "\nAll good.");
process.exit(bad ? 1 : 0);
