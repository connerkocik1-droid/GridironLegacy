/**
 * Which weeks a backfill run should touch.
 *
 * Pulled out of the route because this is the part with edges: a missing
 * parameter, a range the wrong way round, a week nobody has played, and the
 * fact that one HTTP request cannot re-score a whole season before it is cut
 * off. Everything else the route does is a loop.
 */

/** As many as fit in one request before the platform stops listening. */
export const MAX_PER_RUN = 4;

export interface Plan {
  weeks: number[];
  /** Asked for but not attempted this time, because the run has a size. */
  remaining: number[];
  error?: string;
}

/**
 * Reads `?week=`, or `?from=`/`?to=`, into the list to work through.
 *
 * Deliberately refuses rather than guessing. A backfill writes over recorded
 * scores, and "it did something, but not what you meant" is the worst possible
 * outcome for a job somebody runs once against production.
 */
export function plan(params: URLSearchParams, playedThrough: number): Plan {
  const one = params.get("week");
  const from = params.get("from");
  const to = params.get("to");

  if (one != null && (from != null || to != null)) {
    return { weeks: [], remaining: [], error: "Name a week, or a range, but not both" };
  }

  let wanted: number[];

  if (one != null) {
    const week = Number(one);
    if (!Number.isInteger(week) || week < 1) {
      return { weeks: [], remaining: [], error: "week must be a positive integer" };
    }
    wanted = [week];
  } else if (from != null || to != null) {
    const start = Number(from ?? 1);
    const end = Number(to ?? playedThrough);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < 1) {
      return { weeks: [], remaining: [], error: "from and to must be positive integers" };
    }
    if (end < start) {
      return { weeks: [], remaining: [], error: "to must not be before from" };
    }
    wanted = [];
    for (let w = start; w <= end; w++) wanted.push(w);
  } else {
    // Nothing named: every week the season has actually reached. This is the
    // case somebody runs after a fix, and the one that should need no thought.
    wanted = [];
    for (let w = 1; w <= playedThrough; w++) wanted.push(w);
  }

  if (!wanted.length) {
    return { weeks: [], remaining: [], error: "No weeks have been played yet" };
  }

  return { weeks: wanted.slice(0, MAX_PER_RUN), remaining: wanted.slice(MAX_PER_RUN) };
}
