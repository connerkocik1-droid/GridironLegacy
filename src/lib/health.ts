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

import { normalizeName } from "./player-names";

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
  if (s.includes("doubtful") || s.includes("questionable")) return "questionable";
  // "Day-To-Day", "Probable" and "Limited" used to land on questionable too,
  // and they are the reason a badge stopped meaning anything. None of the
  // three is a game designation: limited is a Wednesday practice
  // participation, probable was abolished by the league in 2016, and
  // day-to-day is a phrase reporters use that ESPN leaves on a player for
  // weeks after he is fine. A manager reading a Q wants to know there is a
  // decision to make on Sunday, and none of these says that.
  return "active";
}

/** Whether a status is worth taking up room beside a name. */
/**
 * The designations the reserve will take.
 *
 * This lived in three API routes and a Postgres function, written out longhand
 * in each, and the day it had to change all four were wrong until the last one
 * was found. It is one list now, and ir_eligible() in migration 0060 is its
 * opposite number in the database — the two have to agree, because the button
 * this decides is drawn from here and refused from there.
 *
 * OUT is in it. It is the loosest of the three — a man ruled out for Sunday is
 * not a man whose season is over — but it is far and away the commonest, and
 * leaving it out was what made the reserve feel broken.
 */
export const IR_ELIGIBLE: readonly Health[] = ["out", "ir", "suspended"];

/** Whether a designation, as the injury report spells it, earns the reserve. */
export function canStash(status: string | null | undefined): boolean {
  return IR_ELIGIBLE.includes(String(status ?? "") as Health);
}

/**
 * Whether the live injury report puts a man where the reserve may hold him.
 *
 * The other half of canStash, and the half that is true right now. canStash
 * reads nfl_players.injury_status, which a cron fills once a night; this reads
 * the report itself. The two disagree for most of the week, because an OUT
 * designation is not a fact about Tuesday — it firms up on Friday and again on
 * Sunday morning, and the table is as old as the last sync.
 *
 * That disagreement was the bug. The profile drew a live OUT badge from the
 * report and then decided the button from the table, so a man the page had
 * just called OUT had no way to be sent to the reserve.
 *
 * On the report at all, and not merely questionable. Deliberately broader than
 * canStash's three: everybody on the report is on it for a reason, and a word
 * we do not recognise is still a reason. Questionable is the one exclusion — a
 * doubt is not an absence, and a reserve that took him would be a roster spot
 * anybody could conjure on a Friday.
 */
export function reportStashable(
  report: readonly { name: string; status: string }[],
  name: string,
): boolean {
  const key = normalizeName(name);
  const entry = report.find((e) => normalizeName(e.name) === key);
  return entry ? toHealth(entry.status) !== "questionable" : false;
}

export function worthShowing(status: Health): boolean {
  return status !== "active";
}
