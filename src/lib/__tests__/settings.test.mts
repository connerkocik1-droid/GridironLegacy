/**
 * The numbers a league is born with have to agree with each other.
 *
 * Three of them are written in four places — the browser defaults, the seed
 * script, the SQL seed, and the fixture the mobile audit is measured against —
 * and none of those places reads the others. They have drifted before, and the
 * failure is quiet: a draft that runs six rounds past a full roster and
 * refuses every one of the last picks, or an audit that measures a league
 * nobody has.
 *
 * The invariant that matters is the roster: ten starting slots plus the bench
 * is the cap place_player enforces, and the draft has to fill exactly that.
 * Twenty-four rounds into an eighteen-man roster is not a smaller draft, it is
 * a draft whose last six rounds all fail.
 *
 * The scoring format is here for the same reason and is worse when it drifts,
 * because it drifts silently: a league seeded at half PPR and a scorer
 * defaulting to full disagree by a point a catch, which is ten or fifteen
 * points a week per team and shows up as nothing at all until somebody adds
 * up a box score by hand.
 */

import { readFileSync } from "node:fs";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}`}`);
  if (!pass) failed++;
};

const { DEFAULTS } = await import("@/data/league-settings.js");
const { rosterSize } = await import("@/data/league-settings.js");

const CAP = 18;
const SCORING = "ppr";

console.log("--- the league's own defaults ---");

const starters = Object.values(DEFAULTS.starters as Record<string, number>)
  .reduce((n, v) => n + v, 0);

eq("ten start", starters, 10);
eq("eight sit behind them", DEFAULTS.bench, CAP - starters);
eq("which is a roster of eighteen", rosterSize(DEFAULTS), CAP);
eq("and the draft fills it exactly", DEFAULTS.rounds, CAP);

eq("and it is a full-PPR league", DEFAULTS.scoring, SCORING);

console.log("\n--- and every other place a league is created ---");

/** The value of a numeric key, from JS or from jsonb_build_object. */
const numberIn = (source: string, key: string): number | null => {
  const js = source.match(new RegExp(`\\b${key}:\\s*(\\d+)`));
  if (js) return Number(js[1]);
  const sql = source.match(new RegExp(`'${key}',\\s*(\\d+)`));
  return sql ? Number(sql[1]) : null;
};

/** The same, for a string one — quoted either way round. */
const textIn = (source: string, key: string): string | null => {
  const js = source.match(new RegExp(`\\b${key}:\\s*["']([a-z]+)["']`));
  if (js) return js[1];
  const sql = source.match(new RegExp(`'${key}',\\s*'([a-z]+)'`));
  return sql ? sql[1] : null;
};

for (const [what, file] of [
  ["the seed script", "scripts/seed.mjs"],
  ["the SQL seed", "supabase/seed.sql"],
  ["the audit fixture", "scripts/mobile/fixture.mjs"],
] as const) {
  const source = readFileSync(file, "utf8");
  eq(`${what} benches eight`, numberIn(source, "bench"), CAP - starters);
  eq(`${what} drafts eighteen rounds`, numberIn(source, "rounds"), CAP);
  // The audit fixture states the format on its preseason payload rather than
  // in its settings block, because that payload is what the commissioner's
  // preseason screen is measured against.
  eq(
    `${what} scores full PPR`,
    textIn(source, "scoring") ?? textIn(source, "format"),
    SCORING,
  );
}

console.log("\n--- and nothing falls back to the old format ---");

// Two routes read settings.scoring with a fallback for a league that has no
// such key. A fallback of "half" under a full-PPR league is the drift this
// whole file exists to catch, and it would be invisible: every receiver would
// simply be worth half a point a catch less than the rules page says.
for (const file of ["src/lib/live.ts", "src/app/api/admin/preseason/route.ts"]) {
  const source = readFileSync(file, "utf8");
  const fallbacks = [...source.matchAll(/scoring\s*\?\?\s*"([a-z]+)"/g)].map((m) => m[1]);
  eq(`${file} falls back to full PPR`, fallbacks, [SCORING]);
}

// The commissioner's preseason screen is where the scoring is settled before
// it counts, so it has to name the format rather than echo the settings key.
const preseason = readFileSync("src/components/PreseasonCheck.tsx", "utf8");
eq("the preseason check spells the format out", /full PPR/.test(preseason), true);

// And the one script that checks the scorer against a real week has to use
// the league's format, or it proves the wrong arithmetic against real data.
eq(
  "the scoring verifier uses the league's format",
  readFileSync("scripts/verify-scoring.mts", "utf8")
    .match(/const FORMAT: ScoringFormat = "([a-z]+)";/)?.[1],
  SCORING,
);

console.log("\n--- and the migration that moved an existing league ---");

// A league already in the database does not read any of the above; it carries
// its own settings, and only a migration changes them.
const migration = readFileSync("supabase/migrations/0037_roster_cap.sql", "utf8");
eq("sets the same bench", numberIn(migration, "bench"), CAP - starters);
eq("and the same rounds", numberIn(migration, "rounds"), CAP);

const scoringMigration = readFileSync("supabase/migrations/0038_full_ppr.sql", "utf8");
eq("and the one that moved its scoring", /"scoring":\s*"ppr"/.test(scoringMigration), true);

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
