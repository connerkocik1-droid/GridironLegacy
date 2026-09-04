import { after } from "next/server";
import { autodraftPick } from "./autodraft";
import { pickSecondsFor, readPickClock, type ClockTier } from "./draft-clock";
import { serviceClient } from "./supabase";
import type { LeagueShape } from "./roster";

/**
 * Makes the pick nobody is there to make, from whichever browser noticed.
 *
 * There has been a cron for this since the draft was built, and it is still
 * there — but a cron that runs once a minute means a manager who is not coming
 * costs the room up to a minute a round, and it cannot be made finer without
 * running all night for the two hours a year a draft is on.
 *
 * The room polls every five seconds. Twelve browsers do, in fact, all of them
 * asking the same question the cron asks. So the answer is worked out here,
 * on any poll, and scheduled for after the response has gone out — the manager
 * who happened to trigger it does not wait on it, and the pick lands on
 * everybody's next poll rather than a minute later.
 *
 * Concurrency is the database's problem and always was: autodraft_expired
 * locks the league row and re-checks the clock, so twelve simultaneous
 * triggers make one pick between them and eleven of them return "no open pick".
 */

interface OnTheClock {
  manager_id: string | null;
  round: number;
  overall: number;
}

export interface AutopickInputs {
  leagueId: string;
  state: string;
  pickStartedAt: string | null;
  settings: LeagueShape & { pickClock?: unknown; pickSeconds?: unknown; rounds?: unknown };
  onTheClock: OnTheClock | null;
  /** Whether the manager on the clock has said they will not be here. */
  autodraft: boolean;
  /** Everybody already drafted in this league, and who holds them. */
  rostered: { player_name: string; manager_id: string }[];
  /** How many picks the board holds in total, for working out its depth. */
  totalPicks: number;
  teams: number;
}

/** Whether this pick is one nobody is going to make in time. */
export function autopickDue(
  tiers: ClockTier[],
  input: Pick<AutopickInputs, "state" | "pickStartedAt" | "onTheClock" | "autodraft">,
  now = Date.now(),
): boolean {
  if (input.state !== "running") return false;
  if (!input.onTheClock?.manager_id) return false;

  // Said they would not be here: no clock to wait for.
  if (input.autodraft) return true;

  if (!input.pickStartedAt) return false;
  const started = new Date(input.pickStartedAt).getTime();
  if (Number.isNaN(started)) return false;

  return now >= started + pickSecondsFor(tiers, input.onTheClock.round) * 1000;
}

/**
 * Schedules the pick, if one is due. Returns whether it scheduled anything,
 * which is what the tests read — the work itself deliberately happens after
 * the response and has nothing to report to it.
 */
export function maybeAutopick(input: AutopickInputs): boolean {
  const tiers = readPickClock(input.settings);
  if (!autopickDue(tiers, input)) return false;

  const onTheClock = input.onTheClock!;
  const managerId = onTheClock.manager_id!;

  // Worked out here rather than in the database because the player pool lives
  // in the app. It can be stale by the time the row is locked — somebody else
  // may have taken him in the meantime — which autodraft_expired checks for
  // and reports rather than raising on.
  const taken = new Set(input.rostered.map((r) => r.player_name));
  const roster = input.rostered
    .filter((r) => r.manager_id === managerId)
    .map((r) => r.player_name);

  const rounds = Math.max(
    onTheClock.round,
    input.teams > 0 ? Math.ceil(input.totalPicks / input.teams) : onTheClock.round,
  );

  const fallback = autodraftPick({
    taken,
    roster,
    round: onTheClock.round,
    rounds,
    league: input.settings,
  });

  after(async () => {
    try {
      const { error } = await serviceClient().rpc("autodraft_expired", {
        p_league_id: input.leagueId,
        p_fallback: fallback,
      });
      if (error) console.error("[draft] autopick failed", error);
    } catch (err) {
      // A board that renders is worth more than a pick that is five seconds
      // earlier, and the cron is still there behind this.
      console.error("[draft] autopick failed", err);
    }
  });

  return true;
}
