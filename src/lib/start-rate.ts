import { bestLineup, type Score } from "./matchup";
import { proj, type LeagueShape } from "./roster";
import { rngFrom } from "./mock-draft";

/**
 * How often a player actually starts.
 *
 * Best ball fills the slots by itself, so "starter" and "bench" are not
 * categories a manager can look up — they are outcomes, and they are different
 * every week. A projection tells you a receiver is worth eleven points; it does
 * not tell you whether eleven is enough to beat the other four receivers on the
 * same roster. Those are different questions, and the second one is what
 * decides whether he is worth holding.
 *
 * So: play the week a few hundred times and count. Each player's score is drawn
 * around his projection, the best-ball lineup is filled from the draw, and his
 * start rate is the share of those weeks he made it. A third receiver on a deep
 * roster starts a quarter of the time; the same player on a thin one starts
 * every week. Nothing else on the page says that.
 *
 * Deliberately not a ranking of projections. The whole point is that it is not
 * one — otherwise the top two receivers would read 100% and everybody else 0%,
 * which is what an ordering already tells you.
 */

/**
 * How far a week lands from its projection, as a fraction of it.
 *
 * The same figure win-probability.ts uses, and for the same reason: a receiver
 * projected for twelve scores three, or twenty-four. Sharing it matters more
 * than the exact value — a page that says a man wins 44% of the time and starts
 * 80% of them should be reasoning about one kind of week, not two.
 */
const SPREAD = 0.65;

/**
 * Enough draws to be steady to the nearest per cent, and few enough to run
 * while somebody is looking at the page. Four hundred lands a rate within
 * about two points of where ten thousand would put it, which is finer than a
 * bar three pixels tall can draw.
 */
const WEEKS = 400;

/**
 * A score for one week: the projection, scattered.
 *
 * Never below nought — a player has a bad afternoon, not a negative one — and
 * a man with no projection at all stays at nought rather than being given a
 * random one, because a draw around nothing is noise pretending to be data.
 */
function draw(projection: number, rng: () => number): number {
  if (projection <= 0) return 0;
  // Box–Muller, which turns two uniforms into a normal. The alternative —
  // averaging uniforms — has thin tails, and the tails are the whole reason a
  // fourth receiver ever starts.
  const u = Math.max(1e-9, rng());
  const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
  return Math.max(0, projection * (1 + SPREAD * z));
}

/**
 * The share of simulated weeks each player fills a slot, 0 to 1.
 *
 * Seeded from the roster itself, so the same team gives the same rates every
 * time it is drawn. A number that changes when nothing changed reads as a bug
 * even when it is only arithmetic.
 */
export function startRates(
  roster: string[],
  league: LeagueShape | null,
  projections?: Map<string, number>,
): Map<string, number> {
  const rates = new Map<string, number>();
  if (!roster.length) return rates;

  const projectionOf = (name: string) => projections?.get(name) ?? proj(name);
  for (const name of roster) rates.set(name, 0);

  // The seed is the roster, so it moves when the roster does and not otherwise.
  let seed = roster.length;
  for (const name of roster) {
    for (const ch of name) seed = (seed * 31 + ch.charCodeAt(0)) % 2_147_483_647;
  }
  const rng = rngFrom(seed);

  for (let week = 0; week < WEEKS; week++) {
    const scores = new Map<string, Score>(
      roster.map((name) => [name, { points: draw(projectionOf(name), rng), statLine: "" }]),
    );

    for (const row of bestLineup(roster, league, scores, "points")) {
      if (row.entry) rates.set(row.entry.name, (rates.get(row.entry.name) ?? 0) + 1);
    }
  }

  for (const [name, count] of rates) rates.set(name, count / WEEKS);
  return rates;
}

/**
 * The lineup this roster would field if the week went exactly to projection.
 *
 * What the page marks with a slot chip. Not the same claim as the start rate
 * beside it, and the difference is the point: this is the likeliest single
 * arrangement, and the rate is how often each man survives every other one.
 */
export function optimalLineup(
  roster: string[],
  league: LeagueShape | null,
  projections?: Map<string, number>,
): Map<string, string> {
  const projectionOf = (name: string) => projections?.get(name) ?? proj(name);
  const scores = new Map<string, Score>(
    roster.map((name) => [name, { points: projectionOf(name), statLine: "" }]),
  );

  const slots = new Map<string, string>();
  // Numbered where a league fields more than one — RB1 and RB2 rather than two
  // rows both saying RB, which reads as a mistake.
  const seen: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const row of bestLineup(roster, league, scores, "points")) {
    counts[row.slot] = (counts[row.slot] ?? 0) + 1;
  }

  for (const row of bestLineup(roster, league, scores, "points")) {
    if (!row.entry) continue;
    seen[row.slot] = (seen[row.slot] ?? 0) + 1;
    const label = row.slot === "D/ST" ? "DST" : row.slot;
    slots.set(row.entry.name, counts[row.slot] > 1 ? `${label}${seen[row.slot]}` : label);
  }

  return slots;
}
