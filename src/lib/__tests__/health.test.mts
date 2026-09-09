/**
 * Fitness, and the five words the league runs on.
 *
 * ESPN publishes a longer and less consistent list than the five a manager
 * acts on, so the mapping is the whole of the app's opinion about what its
 * words mean. Getting one wrong shows the wrong badge beside a name on every
 * screen at once, which is the sort of thing that costs somebody a Sunday.
 */
import { toHealth, worthShowing, HEALTH_LABEL, HEALTH_SHORT } from "../health";
import { healthOf } from "../use-player-health";
import { normalizeName } from "../player-names";
import { POOL } from "../../data/league-data";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = got === want;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}`}`);
  if (!pass) failed++;
};
const ok = (label: string, got: boolean) => {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  if (!got) failed++;
};

console.log("--- ESPN's words, in ours ---");

for (const [espn, want] of [
  ["Questionable", "questionable"],
  ["questionable", "questionable"],
  ["Doubtful", "questionable"],
  ["Day-To-Day", "questionable"],
  ["Out", "out"],
  ["Injured Reserve", "ir"],
  ["IR", "ir"],
  ["Reserve/Injured", "ir"],
  ["Suspension", "suspended"],
  ["Reserve/Suspended", "suspended"],
  ["Physically Unable to Perform", "out"],
  ["PUP", "out"],
  ["Active", "active"],
] as const) {
  eq(`"${espn}"`, toHealth(espn), want);
}

console.log("\n--- and the ones that are not a status at all ---");
eq("nothing", toHealth(""), "active");
eq("null", toHealth(null), "active");
eq("undefined", toHealth(undefined), "active");
eq("a word nobody recognises", toHealth("Fine, probably"), "active");

console.log("\n--- the two that must not be confused ---");
// "Reserve/Suspended" contains both words. A suspension is not an injury, and
// a league that stashes a suspended player on IR has a roster rule broken.
eq("a suspension is not injured reserve", toHealth("Reserve/Suspended"), "suspended");
// And a name that merely contains the letters "ir" is not a status.
eq("Irvin is not on IR", toHealth("Michael Irvin"), "active");

console.log("\n--- what gets shown ---");
ok("a fit player wears no badge", !worthShowing("active"));
for (const s of ["questionable", "out", "ir", "suspended"] as const) {
  ok(`${s} does`, worthShowing(s));
}

console.log("\n--- every state has words for it ---");
for (const s of ["active", "questionable", "out", "ir", "suspended"] as const) {
  ok(`${s} has a label`, Boolean(HEALTH_LABEL[s]));
}
// Active's short form is deliberately empty: it is the one never drawn.
eq("active has no short badge", HEALTH_SHORT.active, "");
for (const s of ["questionable", "out", "ir", "suspended"] as const) {
  ok(`${s} has a short badge`, HEALTH_SHORT[s].length > 0 && HEALTH_SHORT[s].length <= 3);
}

console.log("\n--- and a badge only for somebody actually on the report ---");

/**
 * The bug: healthOf used to fall back to the draft pool's `q` column whenever
 * the injury report said nothing, which is the normal case for a fit player.
 * The column is a snapshot from months before the season, so the fallback
 * fired constantly and never expired — 138 of 944 players wore a permanent Q,
 * Christian McCaffrey and Puka Nacua among them.
 */
{
  const report = {
    [normalizeName("Puka Nacua")]: { status: "out" as const, detail: "Out", note: "ankle" },
  };

  eq("somebody on the report gets what the report says",
    healthOf(report, "Puka Nacua")?.status, "out");

  // He is flagged in the pool. He is not on the report. He is fit.
  const flagged = POOL.find((p) => p.q);
  ok(`the pool still remembers a draft-season designation (${flagged?.n})`, Boolean(flagged));
  eq("but it is not today's status", healthOf({}, flagged!.n), null);

  eq("and nobody unknown to either is anything", healthOf({}, "Somebody Nobody Signed"), null);

  // The whole point, stated as a number: with an empty report, nobody wears a
  // badge. Anything else is furniture that hides the names that matter.
  const wearing = POOL.filter((p) => healthOf({}, p.n) !== null).length;
  eq(`no report means no badges, for all ${POOL.length} of them`, wearing, 0);

  eq("a spelling the feed uses still finds him",
    healthOf(report, "Puka Nacua ")?.status, "out");
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
