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

/**
 * What a man is worth over whoever would take his place.
 *
 * Points per game cannot be compared across positions, and the wire advice
 * used to do exactly that. A quarterback averaging 22 outscores every
 * receiver on the board, so the top of every suggestion was a quarterback —
 * and this league starts one. A manager already holding two was being told to
 * pick up a third over a receiver who would actually have played.
 *
 * The comparable number is the surplus: what he scores above the best man at
 * his own position that anybody could have for nothing. A backup quarterback
 * barely clears the best free quarterback, so his surplus is small however
 * large his total. A startable receiver clears a wire full of nobody, so his
 * is large. That is the difference the recommendation is meant to be about,
 * and it falls out of the pool rather than being asserted by a table of
 * positional weights this app would then have to keep true.
 *
 * The bar depends on which side of the wire he is on. For a man on a roster it
 * is the best free agent at his position — that is who replaces him if he goes.
 * For a free agent it is the best free agent who is not him, because that is
 * what is still there if you pass.
 */
export function replacementLevels(free: Held[]): Map<string, [number, number]> {
  const rates = new Map<string, number[]>();
  for (const p of free) {
    if (!p.pos) continue;
    const list = rates.get(p.pos) ?? [];
    list.push(perGame(p));
    rates.set(p.pos, list);
  }

  const out = new Map<string, [number, number]>();
  for (const [pos, list] of rates) {
    list.sort((a, b) => b - a);
    out.set(pos, [list[0] ?? 0, list[1] ?? 0]);
  }
  return out;
}

/**
 * The smallest surplus worth spending a roster spot on, per game.
 *
 * Two a game is a couple of hundred points across a season's lineups. Below
 * that the chip is noise, and a chip on every row carries no information.
 */
export const WORTH_A_SPOT = 2;

export function surplusOf(
  p: Held,
  levels: Map<string, [number, number]>,
  held: boolean,
): number {
  const [best, next] = levels.get(p.pos) ?? [0, 0];
  // A free agent is measured against the best of the others, which for the
  // best of them is the one behind him.
  const bar = held ? best : perGame(p) >= best ? next : best;
  return Math.round((perGame(p) - bar) * 10) / 10;
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

/** The positions a flex slot will take. Never a quarterback: one of those starts. */
export const FLEX_TAKES = ["RB", "WR", "TE"];

/**
 * Whether a slot is short of bodies.
 *
 * The flex needs its own answer, because it is a slot rather than a position
 * and nobody's position is "FLEX". Counting held flexes the way a dedicated
 * slot is counted found nought every time, so every roster in every league
 * that fields a flex — which is every league — was permanently told it was
 * short at FLEX and offered the best man on the wire to fix it.
 *
 * A flex is short when the backs, receivers and tight ends held do not fill
 * their own slots and the flexes between them.
 */
export function isShort(
  slot: string,
  mine: Held[],
  starters: Record<string, number>,
): boolean {
  const need = starters[slot] ?? 0;
  if (!need) return false;

  if (slot === "FLEX") {
    const total = FLEX_TAKES.reduce((n, pos) => n + (starters[pos] ?? 0), 0) + need;
    return mine.filter((p) => FLEX_TAKES.includes(p.pos)).length < total;
  }

  return mine.filter((p) => p.pos === slot).length < need;
}

/** Whether a man can be put in a slot. */
export function fills(pos: string, slot: string): boolean {
  return slot === "FLEX" ? FLEX_TAKES.includes(pos) : pos === slot;
}

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

  const holes = Object.keys(starters).filter((pos) => isShort(pos, mine, starters));

  // Ordered by what each is worth over his own replacement rather than by his
  // raw rate, or the answer is a quarterback every week.
  const levels = replacementLevels(free);
  const best = free
    .slice()
    .sort((a, b) => surplusOf(b, levels, false) - surplusOf(a, levels, false));

  if (holes.length) {
    const fit = best.find((p) => holes.some((hole) => fills(p.pos, hole)));
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

  // The weakest man you hold, and the best thing on the wire, both measured
  // against their own positions. A kicker at 8 a game can be worth more than a
  // third quarterback at 15 — the kicker is the only one you have, and the
  // quarterback is behind two who will always start ahead of him.
  const worst = mine
    .slice()
    .sort((a, b) => surplusOf(a, levels, true) - surplusOf(b, levels, true))[0];

  if (worst) {
    const bar = surplusOf(worst, levels, true);
    const over = best.find((p) => surplusOf(p, levels, false) > bar);
    if (over) {
      return {
        tier: "bench",
        text:
          over.pos === worst.pos
            ? `${over.name} (${perGame(over).toFixed(1)} PG) outscores ${worst.name} ` +
              `(${perGame(worst).toFixed(1)} PG), the weakest ${over.pos} you are holding.`
            : `${over.name} (${perGame(over).toFixed(1)} PG) is worth more at ${over.pos} than ` +
              `${worst.name} (${perGame(worst).toFixed(1)} PG) is at ${worst.pos}, once you ` +
              `count who would replace each of them.`,
      };
    }
    return {
      tier: "none",
      text:
        `Nothing on the wire improves on anyone you are holding. Your weakest spot is ` +
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
  levels: Map<string, [number, number]> = new Map(),
): { label: string; tone: "warn" | "good" } | null {
  const at = (pos: string) =>
    mine.filter((x) => x.pos === pos).sort((a, b) => b.points - a.points);

  if (isShort(p.pos, mine, starters)) {
    return { label: `FILLS ${p.pos}`, tone: "warn" };
  }

  // His own slot is full, but the flexes behind it are not and he can play in
  // one. A quarterback cannot — this league starts exactly one, and a second
  // has nowhere to play.
  if (fills(p.pos, "FLEX") && isShort("FLEX", mine, starters)) {
    return { label: "FILLS FLEX", tone: "warn" };
  }

  const need = starters[p.pos] ?? 0;

  const group = at(p.pos);
  const weak = need && group.length >= need ? group[need - 1] : null;
  if (weak && perGame(p) > perGame(weak)) return { label: "STARTER", tone: "warn" };

  // Across positions the comparison has to be surplus, not rate. Without it
  // every quarterback on the wire wore an OVER chip against somebody's kicker,
  // in a league that starts one quarterback.
  //
  // And a real surplus, not a rounding one. The best free quarterback in a
  // one-quarterback league is a point a game better than the next free
  // quarterback, which clears every negative number on a roster and means
  // nothing — two a game is thirty-four points across a season, which is a
  // move worth making.
  const worst = mine
    .slice()
    .sort((a, b) => surplusOf(a, levels, true) - surplusOf(b, levels, true))[0];
  const gain = surplusOf(p, levels, false);
  if (worst && gain >= WORTH_A_SPOT && gain > surplusOf(worst, levels, true)) {
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
