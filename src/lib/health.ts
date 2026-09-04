/**
 * Whether a player is fit to play.
 *
 * Five states, because those are the five that change what a manager does:
 * start him, worry about him, bench him, stash him, or wait for him. ESPN
 * publishes a longer and less consistent list — "Day-To-Day", "Physically
 * Unable to Perform", "Doubtful" — so the mapping below is the whole of the
 * app's opinion on what those mean, in one place.
 *
 * Active is the default and is never shown as a badge. Every player who is not
 * on an injury report is fit, and a green tick beside all four hundred names on
 * a page is noise that hides the two that matter.
 */

export type Health = "active" | "questionable" | "out" | "ir" | "suspended";

export interface PlayerHealth {
  status: Health;
  /** ESPN's own word for it, which is more precise than our five. */
  detail: string;
  /** What ESPN said about it, when it said anything. */
  note?: string;
}

/** The label shown on a badge. */
export const HEALTH_LABEL: Record<Health, string> = {
  active: "Active",
  questionable: "Questionable",
  out: "Out",
  ir: "IR",
  suspended: "Suspended",
};

/** Short enough to sit beside a name in a table. */
export const HEALTH_SHORT: Record<Health, string> = {
  active: "",
  questionable: "Q",
  out: "OUT",
  ir: "IR",
  suspended: "SUS",
};

export const HEALTH_COLOUR: Record<Health, string> = {
  active: "var(--good)",
  questionable: "var(--warn)",
  out: "var(--bad-soft)",
  ir: "var(--bad)",
  suspended: "var(--suspended)",
};

/**
 * ESPN's word for a status, in our five.
 *
 * Ordered most specific first: "Injured Reserve" contains neither "out" nor
 * "questionable", but "Reserve/Suspended" contains both "reserve" and
 * "suspended" and has to land on the latter.
 */
export function toHealth(espn: string | null | undefined): Health {
  const s = (espn ?? "").toLowerCase();
  if (!s) return "active";

  // "suspen" rather than "suspend": ESPN writes both "Suspended" and
  // "Suspension", and the second has no d in it.
  if (s.includes("suspen")) return "suspended";

  // Any reserve list that is not a suspension. ESPN writes IR as "Injured
  // Reserve", "Reserve/Injured" and plain "IR" depending on the endpoint, and
  // the other reserve lists — PUP, did-not-report — are the same thing to a
  // manager: he is not playing and he is not droppable this week.
  //
  // "IR" is matched as a whole word so that Michael Irvin is not on it.
  if (s.includes("reserve") || /\bir\b/.test(s)) return "ir";
  if (s.includes("physically unable") || s.includes("pup")) return "out";
  if (s.includes("out")) return "out";
  // Doubtful means unlikely rather than ruled out, so it lands with
  // questionable — the manager still has a decision to make, which is the
  // thing the two states are actually distinguishing.
  if (s.includes("doubtful") || s.includes("questionable") || s.includes("day-to-day")) {
    return "questionable";
  }
  if (s.includes("day to day") || s.includes("probable") || s.includes("limited")) {
    return "questionable";
  }
  return "active";
}

/** Whether a status is worth taking up room beside a name. */
export function worthShowing(status: Health): boolean {
  return status !== "active";
}
