/**
 * The every-few-minutes jobs, and the switch in front of them.
 *
 * vercel.json now schedules live scores, email notices and the draft clock
 * every few minutes. Turning those on changes things the league will notice —
 * weeks settle minutes after the last game, lead changes are pushed, notices
 * are emailed — so they must not start because a pull request was merged.
 * These pin that: until FREQUENT_JOBS=on, a frequent run of any of the three
 * answers "skipped" before it reads anything at all, while the daily run and a
 * run by hand go ahead exactly as before.
 */

process.env.CRON_SECRET = "cron-secret-for-tests";
delete process.env.FREQUENT_JOBS;
// No database: a run that got past the switch would fail loudly on this.
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_KEY;
process.env.LEAGUE_ID = "league-for-tests";

const { frequentJobsOff, isFrequentRun } = await import("../frequent-jobs.ts");
const scores = await import("../../app/api/cron/scores/route.ts");
const mail = await import("../../app/api/cron/mail/route.ts");
const autodraft = await import("../../app/api/cron/autodraft/route.ts");

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!pass) failed++;
};

const run = (schedule: string | null, secret = process.env.CRON_SECRET) =>
  new Request("https://pylonn.app/api/cron/x", {
    headers: {
      ...(secret ? { authorization: `Bearer ${secret}` } : {}),
      ...(schedule ? { "x-vercel-cron-schedule": schedule } : {}),
    },
  });

console.log("--- which runs are the frequent ones ---");
eq("every five minutes is", isFrequentRun(run("*/5 * * * *")), true);
eq("every minute is", isFrequentRun(run("* * * * *")), true);
eq("the daily run is not", isFrequentRun(run("0 8 * * *")), false);
eq("the weekly run is not", isFrequentRun(run("0 13 * * 4")), false);
eq("a run by hand carries no schedule and is not", isFrequentRun(run(null)), false);

console.log("\n--- the switch ---");
eq("off by default, a frequent run is turned away", frequentJobsOff(run("*/5 * * * *")) != null, true);
eq("the daily run never is", frequentJobsOff(run("0 8 * * *")), null);
eq("nor a run by hand", frequentJobsOff(run(null)), null);
process.env.FREQUENT_JOBS = "on";
eq("on, the frequent run goes ahead", frequentJobsOff(run("*/5 * * * *")), null);
process.env.FREQUENT_JOBS = " On ";
eq("however it is typed", frequentJobsOff(run("*/5 * * * *")), null);
process.env.FREQUENT_JOBS = "yes";
eq("but only 'on' means on", frequentJobsOff(run("*/5 * * * *")) != null, true);
delete process.env.FREQUENT_JOBS;

console.log("\n--- merged and not turned on, the three routes do nothing ---");
for (const [name, route] of [["scores", scores], ["mail", mail], ["autodraft", autodraft]] as const) {
  const res = await route.GET(run(name === "autodraft" ? "* * * * *" : "*/5 * * * *"));
  const body = await res.json();
  eq(`${name}: a frequent run is skipped, before any database is asked`, [res.status, typeof body.skipped], [200, "string"]);

  const refused = await route.GET(run("*/5 * * * *", "wrong"));
  eq(`${name}: and the secret is still checked first`, refused.status, 401);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
