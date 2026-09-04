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

console.log("--- the league's own defaults ---");

const starters = Object.values(DEFAULTS.starters as Record<string, number>)
  .reduce((n, v) => n + v, 0);

eq("ten start", starters, 10);
eq("eight sit behind them", DEFAULTS.bench, CAP - starters);
eq("which is a roster of eighteen", rosterSize(DEFAULTS), CAP);
eq("and the draft fills it exactly", DEFAULTS.rounds, CAP);

console.log("\n--- and every other place a league is created ---");

/** The value of a numeric key, from JS or from jsonb_build_object. */
const numberIn = (source: string, key: string): number | null => {
  const js = source.match(new RegExp(`\\b${key}:\\s*(\\d+)`));
  if (js) return Number(js[1]);
  const sql = source.match(new RegExp(`'${key}',\\s*(\\d+)`));
  return sql ? Number(sql[1]) : null;
};

for (const [what, file] of [
  ["the seed script", "scripts/seed.mjs"],
  ["the SQL seed", "supabase/seed.sql"],
  ["the audit fixture", "scripts/mobile/fixture.mjs"],
] as const) {
  const source = readFileSync(file, "utf8");
  eq(`${what} benches eight`, numberIn(source, "bench"), CAP - starters);
  eq(`${what} drafts eighteen rounds`, numberIn(source, "rounds"), CAP);
}

console.log("\n--- and the migration that moved an existing league ---");

// A league already in the database does not read any of the above; it carries
// its own settings, and only a migration changes them.
const migration = readFileSync("supabase/migrations/0037_roster_cap.sql", "utf8");
eq("sets the same bench", numberIn(migration, "bench"), CAP - starters);
eq("and the same rounds", numberIn(migration, "rounds"), CAP);

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
