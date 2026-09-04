/**
 * How long a pick gets, which is not one number.
 *
 * Ninety seconds is right for the first round and absurd for the fourteenth.
 * By then the room is picking kickers off a list it settled on an hour ago,
 * and the only thing a long clock buys is eleven people watching a number
 * count down on a pick that was made in four seconds.
 *
 * So the clock is tiered, and the tiers are the league's to set. This module
 * is the one place that reads them; the database has its own copy of the same
 * rule in pick_seconds_for(), because the pick that expires has to be made
 * whether or not a browser is open to notice.
 */

export interface ClockTier {
  /** The last round this tier covers. Null means this one and every round after. */
  throughRound: number | null;
  seconds: number;
}

/** What the league asked for: long enough to think early, brisk at the end. */
export const DEFAULT_PICK_CLOCK: ClockTier[] = [
  { throughRound: 4, seconds: 90 },
  { throughRound: 10, seconds: 75 },
  { throughRound: null, seconds: 60 },
];

/** Nothing shorter than this, whatever a settings blob says. */
export const MIN_SECONDS = 5;
export const MAX_SECONDS = 600;

interface ClockSettings {
  pickClock?: unknown;
  /** What a league had before the clock was tiered: one number for the draft. */
  pickSeconds?: unknown;
}

/**
 * The tiers a league is actually running, from whatever its settings hold.
 *
 * Deliberately forgiving. This is read on the path that draws a countdown and
 * on the path that makes a pick, and a typo in a settings blob must not be
 * able to stop a draft — a malformed tier is skipped, and a settings blob with
 * nothing usable in it falls back to the league default rather than to zero.
 */
export function readPickClock(settings: ClockSettings | null | undefined): ClockTier[] {
  const raw = settings?.pickClock;

  if (Array.isArray(raw)) {
    const tiers: ClockTier[] = [];
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const tier = entry as { throughRound?: unknown; seconds?: unknown };

      const seconds = Number(tier.seconds);
      if (!Number.isFinite(seconds) || seconds <= 0) continue;

      const through =
        tier.throughRound == null ? null : Math.floor(Number(tier.throughRound));
      if (through != null && (!Number.isFinite(through) || through < 1)) continue;

      tiers.push({
        throughRound: through,
        seconds: Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(seconds))),
      });
    }
    if (tiers.length) return tiers;
  }

  // A league from before the clock was tiered: one number for the whole draft.
  const flat = Number(settings?.pickSeconds);
  if (Number.isFinite(flat) && flat > 0) {
    return [
      { throughRound: null, seconds: Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Math.round(flat))) },
    ];
  }

  return DEFAULT_PICK_CLOCK;
}

/**
 * The clock for one round.
 *
 * First tier that covers the round wins, which is why the order of the array
 * is the order of the draft. A round past every stated throughRound falls to
 * the open-ended tier if there is one, and to the last tier if there is not —
 * a draft must not reach round eleven and find it has no clock.
 */
export function pickSecondsFor(tiers: ClockTier[], round: number | null | undefined): number {
  const at = Math.max(1, Math.floor(Number(round) || 1));

  for (const tier of tiers) {
    if (tier.throughRound == null || tier.throughRound >= at) return tier.seconds;
  }

  return tiers[tiers.length - 1]?.seconds ?? DEFAULT_PICK_CLOCK[0].seconds;
}

/** Which rounds a tier covers, as the commissioner reads it: "Rounds 5–10". */
export function tierRounds(tiers: ClockTier[], index: number): string {
  const from = index === 0 ? 1 : (tiers[index - 1].throughRound ?? 0) + 1;
  const through = tiers[index]?.throughRound;

  if (through == null) return from === 1 ? "Every round" : `Round ${from} on`;
  if (through <= from) return `Round ${from}`;
  return `Rounds ${from}–${through}`;
}

/** The whole clock in one line, for a room that wants to know what it is on. */
export function describeClock(tiers: ClockTier[]): string {
  return tiers.map((t, i) => `${tierRounds(tiers, i)}: ${t.seconds}s`).join(" · ");
}
