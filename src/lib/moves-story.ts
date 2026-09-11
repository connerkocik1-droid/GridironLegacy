/**
 * What the Moves screen works out for itself.
 *
 * The handoff's premise, same as the League screen's: the badges, the
 * countdown, the roster advice and the trade verdict are computed rather than
 * written. Each one branches, and flattening a branch is how a screen ends up
 * telling everybody the same thing.
 *
 * One decision taken differently from the prototype, and the handoff invites
 * it. The prototype replays a transaction log to work out who owns whom,
 * because it has no database; it warns that reading ownership separately from
 * a log is only safe while the two cannot disagree. Here they cannot: a claim,
 * an add and a trade all write roster_slots and transactions inside one
 * function, so the roster IS the settled log rather than a cache of it.
 * Replaying it in the browser would be a second implementation of ownership,
 * and a second implementation is the thing the warning is about.
 */

export interface Held {
  name: string;
  pos: string;
  points: number;
  games: number;
}

/** Points per game, or nought for a man who has not played. */
export function perGame(p: Held): number {
  return p.games > 0 ? p.points / p.games : 0;
}

// ------------------------------------------------------------- waivers ---

/**
 * When the next waiver run is.
 *
 * The hour has to match vercel.json — the countdown is a promise about when
 * something happens, and a clock that disagrees with the cron is worse than no
 * clock. 08:00 UTC is where `/api/cron/waivers` is scheduled.
 */
export const WAIVER_HOUR_UTC = 8;

export function nextWaiverRun(now: Date, hourUtc = WAIVER_HOUR_UTC): Date {
  const next = new Date(now);
  next.setUTCHours(hourUtc, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/** "7:12:44" — what is left before it runs. */
export function countdown(now: Date, hourUtc = WAIVER_HOUR_UTC): string {
  const ms = Math.max(0, nextWaiverRun(now, hourUtc).getTime() - now.getTime());
  const s = Math.floor(ms / 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

// ------------------------------------------------------------ trending ---

export interface Move {
  kind: string;
  player: string;
}

export interface Trend {
  name: string;
  /** Adds minus drops across the window. */
  net: number;
  moves: number;
}

/**
 * Who the league has been moving, busiest first.
 *
 * Counted rather than ranked by points: this strip is about attention, and a
 * player three managers have chased is news whether or not he is any good.
 */
export function trending(moves: Move[], limit = 8): Trend[] {
  const counts = new Map<string, { adds: number; drops: number }>();

  for (const m of moves) {
    const row = counts.get(m.player) ?? { adds: 0, drops: 0 };
    const kind = m.kind.toLowerCase();
    if (kind === "drop" || kind === "sent") row.drops += 1;
    else row.adds += 1;
    counts.set(m.player, row);
  }

  return [...counts.entries()]
    .map(([name, c]) => ({ name, net: c.adds - c.drops, moves: c.adds + c.drops }))
    .sort((a, b) => b.moves - a.moves || b.net - a.net || a.name.localeCompare(b.name))
    .slice(0, limit);
}

// -------------------------------------------------------- what you need ---

export type NeedTier = "hole" | "starter" | "bench" | "none";

export interface Need {
  tier: NeedTier;
  text: string;
}

/**
 * What the wire could do for this roster, in four tiers.
 *
 * It falls through so that something always renders. An earlier version of
 * this compared free agents only against starters, which on a decent roster is
 * true almost never — so the module was invisible most weeks, which is the
 * same as not having built it.
 */
export function rosterNeed(
  mine: Held[],
  free: Held[],
  starters: Record<string, number>,
): Need {
  const at = (pos: string) =>
    mine.filter((p) => p.pos === pos).sort((a, b) => b.points - a.points);

  const holes = Object.keys(starters).filter((pos) => at(pos).length < (starters[pos] ?? 0));
  const best = free.slice().sort((a, b) => perGame(b) - perGame(a));

  if (holes.length) {
    const fit = best.find((p) => holes.includes(p.pos));
    return {
      tier: "hole",
      text:
        `You are short at ${holes.join(" and ")}. ` +
        (fit ? `${fit.name} is the best available fit.` : "The pool is thin there this week."),
    };
  }

  // The weakest man actually filling a starting slot at his position.
  const weakStarter = (pos: string) => {
    const group = at(pos);
    const n = starters[pos] ?? 0;
    return n && group.length >= n ? group[n - 1] : null;
  };

  for (const p of best) {
    const weak = weakStarter(p.pos);
    if (weak && perGame(p) > perGame(weak)) {
      return {
        tier: "starter",
        text:
          `${p.name} is averaging ${perGame(p).toFixed(1)} a game, ahead of ${weak.name} ` +
          `at ${perGame(weak).toFixed(1)} in your ${p.pos} slot.`,
      };
    }
  }

  const worst = mine.slice().sort((a, b) => perGame(a) - perGame(b))[0];
  if (worst) {
    const over = best.find((p) => perGame(p) > perGame(worst));
    if (over) {
      return {
        tier: "bench",
        text:
          `${over.name} (${perGame(over).toFixed(1)} PG) outscores ${worst.name} ` +
          `(${perGame(worst).toFixed(1)} PG), the weakest player you are holding.`,
      };
    }
    return {
      tier: "none",
      text:
        `Nothing on the wire outscores anyone you are holding. Your weakest spot is ` +
        `${worst.name} at ${perGame(worst).toFixed(1)} a game.`,
    };
  }

  return { tier: "none", text: "Nothing on your roster yet, so everything on the wire is an upgrade." };
}

/**
 * The badge on a free agent's row, or nothing.
 *
 * Nothing is the common case and it has to stay that way: a chip on every row
 * carries no information. Each tier is relative to this roster rather than to
 * an absolute number, so the same player is a starter for one manager and
 * noise for another — which is the honest answer.
 */
export function fitChip(
  p: Held,
  mine: Held[],
  starters: Record<string, number>,
): { label: string; tone: "warn" | "good" } | null {
  const at = (pos: string) =>
    mine.filter((x) => x.pos === pos).sort((a, b) => b.points - a.points);

  const need = starters[p.pos] ?? 0;
  if (need && at(p.pos).length < need) {
    return { label: `FILLS ${p.pos}`, tone: "warn" };
  }

  const group = at(p.pos);
  const weak = need && group.length >= need ? group[need - 1] : null;
  if (weak && perGame(p) > perGame(weak)) return { label: "STARTER", tone: "warn" };

  const worst = mine.slice().sort((a, b) => perGame(a) - perGame(b))[0];
  if (worst && perGame(p) > perGame(worst)) {
    return { label: `OVER ${worst.name.split(" ").slice(-1)[0].toUpperCase()}`, tone: "good" };
  }

  return null;
}

// ---------------------------------------------------------------- trades ---

/**
 * How well two rosters fit, as a count of slots they could fix for each other.
 *
 * A position counts only where one side is genuinely short and the other
 * genuinely deep. Crediting surplus alone makes everybody somebody's best
 * partner, and a badge every manager wears says nothing.
 */
export function fitScore(
  mine: Held[],
  theirs: Held[],
  starters: Record<string, number>,
): number {
  let score = 0;
  for (const pos of Object.keys(starters)) {
    const need = starters[pos] ?? 0;
    if (!need) continue;
    const me = mine.filter((p) => p.pos === pos).length;
    const them = theirs.filter((p) => p.pos === pos).length;
    if (me < need && them > need) score += Math.min(need - me, them - need);
    if (them < need && me > need) score += Math.min(need - them, me - need);
  }
  return score;
}

/**
 * A pick's worth, from its round and where the standings put it.
 *
 * Derived rather than looked up, so it moves as the season does: the same
 * second-rounder is worth more to a team going badly, which is what makes a
 * pick tradeable at all. A default rather than gospel — a real value chart
 * could replace the arithmetic and keep the derivation.
 */
export function pickValue(round: number, slot: number, teams = 12): number {
  const rounds = 5;
  const depth = Math.max(0, rounds + 1 - round) / rounds;
  return depth * (30 + (teams - 2 - slot) * 2.5);
}

/** Weakest roster first, which is the order a dynasty draft runs in. */
export function draftOrder(rosters: { id: string; points: number }[]): string[] {
  return rosters
    .slice()
    .sort((a, b) => a.points - b.points || a.id.localeCompare(b.id))
    .map((r) => r.id);
}

export interface Sweetener {
  id: string;
  label: string;
  side: "send" | "get";
  text: string;
}

/**
 * The one pick that would even up a lopsided offer, if there is one.
 *
 * Suppressed unless a single pick actually lands the deal near even. A
 * suggestion that leaves the gap where it was is worse than saying nothing:
 * it looks like advice and costs a tap to discover it is not.
 */
export function balancer(
  gap: number,
  candidates: { id: string; label: string; value: number }[],
  who: string,
): Sweetener | null {
  const target = Math.abs(gap);
  if (target < 5 || !candidates.length) return null;

  const side = gap > 0 ? "send" : "get";
  const best = candidates
    .slice()
    .sort((a, b) => Math.abs(a.value - target) - Math.abs(b.value - target))[0];

  const left = Math.abs(target - best.value);
  if (left > 8) return null;

  return {
    id: best.id,
    label: best.label,
    side,
    text:
      `Adding ${side === "send" ? "your" : `${who}'s`} ${best.label} brings it within ` +
      `${left.toFixed(1)} points.`,
  };
}

/** What the offer as it stands amounts to. */
export function verdict(gap: number, anything: boolean, who: string): string {
  if (!anything) {
    return (
      "Pick players or picks from either side. A player is worth what he has scored this " +
      "season; a pick is worth its round and where the standings currently place it."
    );
  }
  if (Math.abs(gap) < 5) {
    return `Within ${Math.abs(gap).toFixed(1)} points. As even as trades get — this one comes down to roster fit.`;
  }
  if (gap > 0) {
    return `You come out ${gap.toFixed(1)} points ahead on the season. ${who} will want the gap closed.`;
  }
  return `You give up ${Math.abs(gap).toFixed(1)} points of production. Worth it only if you are buying the schedule ahead.`;
}
