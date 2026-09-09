import { player } from "@/lib/roster";

/**
 * How many of a position one roster may draft.
 *
 * A league rule, not a matter of taste — the difference matters, because the
 * mock opponents already have a taste rule (mock-draft's HARD_CAP: nobody
 * takes a third quarterback in the ninth round) and it answers a different
 * question. That one is what a sensible drafter does. This is what the room
 * will let anybody do, sensible or not, and it is the one that has to be
 * enforced in the database rather than in a component.
 *
 * The reason it exists at all is a draft nobody enjoys: one manager takes six
 * quarterbacks in the middle rounds, and the other eleven spend the season
 * with the waiver wire picked clean of a position they each need one of. A cap
 * is not about stopping a bad team, it is about stopping one roster from
 * emptying a shelf everybody shares.
 *
 * Running backs, receivers and tight ends are deliberately uncapped. There are
 * hundreds of them, every roster starts several, and hoarding them costs the
 * hoarder as much as anybody — the shelf does not run out.
 *
 * A position that is not in the map has no cap. An empty map is a league with
 * no caps at all, which is a league saying so rather than a league that forgot.
 */

/** What the app applies when a league has never said. */
export const DEFAULT_CAPS: Record<string, number> = {
  QB: 4,
  "D/ST": 2,
  K: 2,
};

/** The positions a cap can be set on, in the order they are shown. */
export const CAPPABLE = ["QB", "RB", "WR", "TE", "D/ST", "K"] as const;

export interface CapShape {
  positionCaps?: Record<string, unknown> | null;
}

/**
 * This league's caps, read from its own settings.
 *
 * A stored map wins outright rather than merging over the defaults: a
 * commissioner who has cleared the quarterback cap means there is no
 * quarterback cap, and merging would put it back.
 */
export function positionCaps(league?: CapShape | null): Record<string, number> {
  const stored = league?.positionCaps;
  if (stored == null || typeof stored !== "object") return { ...DEFAULT_CAPS };

  const out: Record<string, number> = {};
  for (const [position, raw] of Object.entries(stored as Record<string, unknown>)) {
    const n = Number(raw);
    // Nought is a real cap — "nobody may draft one" — so only a value that is
    // not a whole number at all is dropped.
    if (Number.isInteger(n) && n >= 0) out[position] = n;
  }
  return out;
}

/** How many of `position` this manager already holds. */
export function heldAt(drafted: string[], position: string): number {
  let n = 0;
  for (const name of drafted) {
    // A player the pool has never heard of has no position. He is not counted
    // against a cap, because guessing would refuse a legal pick.
    if (player(name)?.p === position) n++;
  }
  return n;
}

/**
 * Why this player cannot be drafted, or null if he can.
 *
 * Returns the sentence rather than a boolean so the room, the button and the
 * database error all say the same thing, in the same words.
 */
export function capBlock(
  drafted: string[],
  position: string | null | undefined,
  league?: CapShape | null,
): string | null {
  if (!position) return null;

  const cap = positionCaps(league)[position];
  if (cap == null) return null;

  const held = heldAt(drafted, position);
  if (held < cap) return null;

  return cap === 0
    ? `No ${position} may be drafted in this league.`
    : `You already have ${held} ${position}${held === 1 ? "" : "s"} — the limit is ${cap}.`;
}

/** Every position this roster is now full at, for marking a list in one pass. */
export function fullAt(drafted: string[], league?: CapShape | null): Set<string> {
  const caps = positionCaps(league);
  const full = new Set<string>();
  for (const [position, cap] of Object.entries(caps)) {
    if (heldAt(drafted, position) >= cap) full.add(position);
  }
  return full;
}

/** "4 QB · 2 D/ST · 2 K", or null where a league caps nothing. */
export function capSummary(league?: CapShape | null): string | null {
  const caps = positionCaps(league);
  const parts = CAPPABLE.filter((p) => caps[p] != null).map((p) => `${caps[p]} ${p}`);
  return parts.length ? parts.join(" · ") : null;
}
