/**
 * The every-few-minutes jobs, and the one switch that turns them on.
 *
 * These were meant to run from .github/workflows/cron.yml, and never did: all
 * 292 scheduled runs from August 30 to September 29 stopped at their first
 * line for want of a SITE_URL secret, and GitHub only ran the "every five
 * minutes" schedule about ten times a day besides. Vercel's own scheduler
 * already runs this project's push job every ten minutes to the minute, so the
 * frequent jobs live in vercel.json now, beside the daily ones.
 *
 * Off until the league turns them on, because on is a change the league will
 * notice: the week settles minutes after its last game rather than at the
 * next morning's run, a matchup's lead changing hands during a game is pushed
 * to the phones that asked for it, and — where a mail provider is configured —
 * notices are emailed. All of it is what these jobs were built to do; none of
 * it should start because a pull request was merged. Set FREQUENT_JOBS=on in
 * the Vercel environment and redeploy.
 *
 * The daily runs, and any job run by hand, are unaffected by the switch.
 */

export const FREQUENT_JOBS_ENV = "FREQUENT_JOBS";

/**
 * Whether this run came from one of the every-few-minutes schedules.
 *
 * Vercel names the schedule that fired in x-vercel-cron-schedule. A frequent
 * one does not fix its minute — "*\/5 * * * *", "* * * * *" — where every
 * daily and weekly one does, and a run by hand carries no schedule at all.
 */
export function isFrequentRun(req: Request): boolean {
  const schedule = req.headers.get("x-vercel-cron-schedule")?.trim() ?? "";
  return schedule.startsWith("*");
}

export function frequentJobsOn(): boolean {
  return process.env[FREQUENT_JOBS_ENV]?.trim().toLowerCase() === "on";
}

/**
 * The answer a frequent run gives while the switch is off, or null to go on.
 * Cheap on purpose: it is answered before anything else is read.
 */
export function frequentJobsOff(req: Request): Response | null {
  if (!isFrequentRun(req) || frequentJobsOn()) return null;
  return Response.json({
    ok: true,
    skipped: `The frequent jobs are off. Set ${FREQUENT_JOBS_ENV}=on in the Vercel environment to run them.`,
  });
}
