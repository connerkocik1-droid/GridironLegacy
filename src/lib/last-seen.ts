"use client";

/**
 * When this manager last looked, and what the score was when they did.
 *
 * Every fantasy app can tell you the score. None of them can tell you what
 * changed since you put your phone down, which is the question somebody
 * actually has when they pick it back up — on a Sunday evening, on Monday
 * morning, after a nap. "104.6" answers nothing on its own; "you were six
 * behind and you are now six in front" is the whole afternoon in one line.
 *
 * Per browser, in localStorage, like the theme. It is a convenience about
 * this device rather than a fact about the league, and a manager who reads
 * the app on a phone and a laptop should get an honest answer on each rather
 * than one of them stealing the other's mark.
 */

export interface Seen {
  /** ISO, when the mark was set. */
  at: string;
  /** This manager's own total at that moment, if a week was being played. */
  mine: number | null;
  /** Their opponent's, so the gap can be compared and not just the score. */
  theirs: number | null;
}

export const SEEN_KEY = "pylon:seen";

/** Below this the answer is "nothing, you were just here". */
export const STALE_MS = 30 * 60_000;

export function readSeen(): Seen | null {
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    if (!raw) return null;
    const seen = JSON.parse(raw) as Seen;
    return typeof seen?.at === "string" ? seen : null;
  } catch {
    // Storage off, or something else wrote nonsense to the key. Either way
    // there is no mark, which is the same as a first visit.
    return null;
  }
}

export function writeSeen(next: Seen): void {
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(next));
  } catch {
    // Then this device does not get the "since you looked" line. Nothing else
    // depends on it.
  }
}
