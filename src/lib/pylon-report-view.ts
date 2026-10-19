/**
 * Pure math for the Pylon Report page: the sparkline points a trend line
 * draws, and the weekly history those trails read. Ported from the
 * "Pylon Report Web" design handoff's spark()/sparkFields(), which this
 * matches point for point — only the inputs differ: real published weeks
 * instead of a seeded fake history.
 */

/** Points for a 76×24 sparkline. Ranks invert so No. 1 sits at the top. */
export function spark(
  vals: number[],
  lo: number,
  hi: number,
  invertY: boolean,
): { points: string; end: [number, number] } {
  const W = 76;
  const H = 24;
  const pad = 3;
  const pts = vals.map((v, i): [number, number] => {
    const t = (v - lo) / (hi - lo || 1);
    const y = pad + (invertY ? t : 1 - t) * (H - pad * 2);
    return [Math.round(((i * W) / (vals.length - 1)) * 10) / 10, Math.round(y * 10) / 10];
  });
  return { points: pts.map((p) => p.join(",")).join(" "), end: pts[pts.length - 1] };
}

export interface SparkFields {
  spark: string;
  endX: number;
  endY: number;
  /** true = improving (lower rank / higher rating), false = worsening, null = flat. */
  better: boolean | null;
}

export function sparkFields(vals: number[], lo: number, hi: number, invertY: boolean, delta: number): SparkFields {
  const sp = spark(vals, lo, hi, invertY);
  return {
    spark: sp.points,
    endX: sp.end[0],
    endY: sp.end[1],
    better: delta > 0 ? true : delta < 0 ? false : null,
  };
}

/**
 * A rank trail: up to four points (oldest to newest) from real published
 * weeks, padded at the front with the oldest known value when there's less
 * than four weeks of history yet. `max + 1` stands in for "unranked that
 * week," same as the design's own convention.
 */
export function rankTrail(weeklyRanks: (number | null)[], max: number): number[] {
  const vals = weeklyRanks.map((v) => v ?? max + 1);
  while (vals.length < 4) vals.unshift(vals[0] ?? max + 1);
  return vals.slice(-4);
}

/** Same idea for a rating history, with no "unranked" floor to pad toward. */
export function ratingTrail(weeklyRatings: number[]): number[] {
  const vals = weeklyRatings.slice();
  while (vals.length < 4) vals.unshift(vals[0] ?? vals[vals.length - 1] ?? 0);
  return vals.slice(-4);
}

/**
 * Lines up a week-over-week number (a rank, a rating) for every entity that
 * appeared in any of the given weeks, oldest to newest, `null` for a week it
 * didn't appear in. The input is already each week's full published board
 * (ranked + honorable), oldest first.
 */
export function weeklyValues<E>(
  weeks: { ranked: E[]; honorable: E[] }[],
  keyOf: (e: E) => string,
  valueOf: (e: E) => number,
): Record<string, (number | null)[]> {
  const perWeek = weeks.map((w) => {
    const m = new Map<string, number>();
    for (const e of [...w.ranked, ...w.honorable]) m.set(keyOf(e), valueOf(e));
    return m;
  });
  const keys = new Set<string>();
  for (const m of perWeek) for (const k of m.keys()) keys.add(k);

  const out: Record<string, (number | null)[]> = {};
  for (const k of keys) out[k] = perWeek.map((m) => m.get(k) ?? null);
  return out;
}
