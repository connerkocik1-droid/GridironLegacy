/**
 * Checks the assumptions src/lib/espn.ts and src/lib/scoring.ts make about
 * ESPN's undocumented endpoints. Run it from a network that can reach ESPN,
 * ideally during a live game week:
 *
 *   node scripts/verify-espn.mjs          # the current scoreboard
 *   node scripts/verify-espn.mjs 5        # week 5 of the regular season
 *
 * It prints the stat-group labels the box score actually returned. Every label
 * scoring.ts reads must appear there; anything reported MISSING means ESPN has
 * changed shape and scoring.ts needs the new name.
 */

const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

// Labels scoring.ts depends on, by ESPN stat group.
const REQUIRED = {
  passing: ["YDS", "TD", "INT", "C/ATT"],
  rushing: ["CAR", "YDS", "TD"],
  receiving: ["REC", "YDS", "TD"],
  kicking: ["FG", "XP", "LONG"],
  fumbles: ["LOST"],
};

const week = process.argv[2];
const params = new URLSearchParams({ seasontype: "2" });
if (week) params.set("week", week);

const board = await fetch(`${SITE}/scoreboard?${params}`).then((r) => r.json());
const events = board.events ?? [];

console.log(`scoreboard: ${events.length} games\n`);
if (!events.length) {
  console.log("No games returned. Try a week number during the regular season.");
  process.exit(0);
}

for (const e of events.slice(0, 3)) {
  const comp = e.competitions?.[0] ?? {};
  const type = comp.status?.type ?? {};
  const teams = (comp.competitors ?? [])
    .map((c) => `${c.team?.abbreviation} ${c.score}`)
    .join(" vs ");
  console.log(`  ${e.id}  ${teams}  [${type.state}] ${type.shortDetail ?? ""}`);
}

const sample = events.find((e) => e.competitions?.[0]?.status?.type?.state !== "pre") ?? events[0];
console.log(`\nreading box score for event ${sample.id}…`);

const summary = await fetch(`${SITE}/summary?event=${sample.id}`).then((r) => r.json());
const teams = summary.boxscore?.players ?? [];

if (!teams.length) {
  console.log("No box score yet — normal before kickoff. Re-run during a live game.");
  process.exit(0);
}

const seen = new Map();
for (const team of teams) {
  for (const group of team.statistics ?? []) {
    if (!seen.has(group.name)) seen.set(group.name, group.labels ?? []);
  }
}

let bad = 0;
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
  if (!seen.has(group)) console.log(`\n  MISSING GROUP: ${group}`);
}

console.log(bad ? `\n${bad} label(s) drifted. Update src/lib/scoring.ts.` : "\nAll labels present.");
