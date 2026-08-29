// The startup draft, replayed deterministically off consensus ADP. Both the
// League page and the trade engine read rosters from here, so the twelve teams
// are the same twelve teams on every screen.

export const LINEUP_SLOTS = ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX", "D/ST", "K"];
export const FLEX_TAKES = ["RB", "WR", "TE"];
export const ROUNDS = 24;

let ACTIVE = null;

// Set once per page, from the commissioner's stored settings. Every function
// below reads the shape through it, so changing a slot count on the
// Commissioner page changes the lineups, the draft and the projections.
export function useSettings(settings) { ACTIVE = settings || null; }

// The commissioner's settings, when the caller has them. Everything below reads
// the shape through these, so changing a slot count on the Commissioner page
// actually changes the lineups, the draft and the projections.
export function slotsOf(settings) {
  const s = settings || ACTIVE;
  if (!s || !s.starters) return LINEUP_SLOTS;
  const out = [];
  ["QB", "RB", "WR", "TE", "FLEX", "D/ST", "K"].forEach(pos => {
    for (let i = 0; i < (s.starters[pos] || 0); i++) out.push(pos);
  });
  return out.length ? out : LINEUP_SLOTS;
}

export function roundsOf(settings) {
  const s = settings || ACTIVE;
  return (s && s.rounds) || ROUNDS;
}

// How many of each position a team wants, and the most it will carry. Derived
// from the starting lineup: a league starting three receivers needs more of them
// than one starting two, and nobody should be forced to guess these by hand.
export function targetsOf(settings) {
  const cfg = settings || ACTIVE;
  const slots = slotsOf(cfg);
  const bench = (cfg && cfg.bench != null) ? cfg.bench : 14;
  const start = {};
  slots.forEach(p => { start[p] = (start[p] || 0) + 1; });
  const flex = start.FLEX || 0;
  const want = {}, caps = {};
  ["QB", "RB", "WR", "TE", "K", "D/ST"].forEach(pos => {
    const s = start[pos] || 0;
    if (!s) { want[pos] = 0; caps[pos] = 0; return; }
    // Skill positions carry bench depth in proportion to how many they start,
    // plus a share of the flex spots. Kickers and defenses never need depth.
    if (pos === "K" || pos === "D/ST") { want[pos] = s; caps[pos] = s + 1; return; }
    const flexShare = pos === "QB" ? 0 : flex / 3;
    const depth = Math.round((s + flexShare) * (bench / 8));
    want[pos] = s + Math.max(pos === "QB" ? 1 : 1, depth);
    caps[pos] = want[pos] + 1;
  });
  return { want, caps };
}
const SEED = 20260822;

const RNG = seed => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

// Points per game off 2025 production, in this league's scoring. Players with
// nothing on file fall back to a curve on consensus ADP.
export function proj(m, p) {
  if (!p) return 0;
  if (m.KICK[p.n]) return +m.KICK[p.n].ppg;
  if (p.p === "D/ST" && m.DEFENSE[p.t]) return +m.DEFENSE[p.t].ppg;
  const pa = m.PASS[p.n], ru = m.RUSH[p.n], re = m.RECV[p.n];
  const gp = Math.max(pa ? pa.gp : 0, ru ? ru.gp : 0, re ? re.gp : 0);
  if (gp) {
    let pts = 0;
    if (pa) pts += pa.yds / 25 + pa.td * 4 - pa.int * 2;
    if (ru) pts += ru.yds / 10 + ru.td * 6;
    if (re) pts += re.yds / 10 + re.td * 6 + re.rec * 0.5;
    return Math.round((pts / gp) * 10) / 10;
  }
  return Math.round(Math.max(2, 26 - Math.log(Math.max(1, p.adp)) * 4) * 10) / 10;
}

// Twelve snake rounds off consensus ADP, nudged by need and capped by position,
// so no team ends with four quarterbacks and everybody has a kicker.
export function buildLeague(m, settings) {
  const { want: WANT, caps: CAPS } = targetsOf(settings);
  const ROUNDS = roundsOf(settings);
  const rand = RNG(SEED);
  const n = m.TEAMS.length;
  const taken = {};
  const rosters = m.TEAMS.map(() => []);
  for (let ov = 1; ov <= ROUNDS * n; ov++) {
    const r = Math.ceil(ov / n);
    const i = (ov - 1) % n;
    const col = r % 2 === 1 ? i : n - 1 - i;
    // Roster entries are { p: <player>, ov, r }, so the position lives at x.p.p —
    // keying off x.p would count player objects and never match a position.
    const have = rosters[col].reduce((s, x) => (s[x.p.p] = (s[x.p.p] || 0) + 1, s), {});
    const roundsLeft = ROUNDS - r + 1;
    let best = null, bestCost = Infinity;
    for (let k = 0; k < m.POOL.length; k++) {
      const p = m.POOL[k];
      if (taken[p.n]) continue;
      const held = have[p.p] || 0;
      if (held >= (CAPS[p.p] || 99)) continue;
      let cost = p.adp;
      const need = (WANT[p.p] || 0) - held;
      cost += need > 0 ? -Math.min(need, 2) * 4 : 40;
      if (p.p === "K" || p.p === "D/ST") cost += (need > 0 && roundsLeft <= 2) ? -300 : 400;
      cost += rand() * 5;
      if (cost < bestCost) { bestCost = cost; best = p; }
    }
    if (!best) break;
    taken[best.n] = 1;
    rosters[col].push({ p: best, ov: ov, r: r });
  }
  return rosters;
}

// The best legal ten from a roster: named slots first, then the flexes.
export function startersOf(m, roster, settings) {
  const pool = roster.slice().sort((a, b) => proj(m, b.p) - proj(m, a.p));
  const used = {};
  const out = [];
  slotsOf(settings).forEach(slot => {
    const accepts = slot === "FLEX" ? FLEX_TAKES : [slot];
    let hit = null;
    for (let i = 0; i < pool.length; i++) {
      if (!used[i] && accepts.indexOf(pool[i].p.p) > -1) { used[i] = 1; hit = pool[i]; break; }
    }
    out.push({ slot: slot, x: hit });
  });
  return out;
}

// What a roster is worth per week: the sum of its best legal lineup.
export function lineupPoints(m, roster, settings) {
  return startersOf(m, roster, settings).reduce((s, r) => s + (r.x ? proj(m, r.x.p) : 0), 0);
}

// Dynasty value: this season's rate, weighted by the years a player has left.
// A 24-year-old and a 31-year-old at the same points per game are not the same
// asset, which is the whole premise of a dynasty league.
export function dynastyValue(m, p) {
  const rate = proj(m, p);
  const age = m.ageOf(p);
  if (age == null || p.p === "K" || p.p === "D/ST") return Math.round(rate * 10) / 10;
  const peak = p.p === "RB" ? 26 : p.p === "QB" ? 30 : 27;
  const cliff = p.p === "RB" ? 29 : p.p === "QB" ? 36 : 31;
  let curve = 1;
  if (age < peak) curve = 1 + (peak - age) * 0.05;
  else if (age > cliff) curve = Math.max(0.4, 1 - (age - cliff) * 0.11);
  return Math.round(rate * curve * 10) / 10;
}

// Future picks become tradeable in week 8. Two seasons out, one per round.
export function pickAssets(team, fromYear) {
  const out = [];
  [fromYear, fromYear + 1].forEach(yr => {
    [1, 2, 3, 4].forEach(rd => {
      out.push({ kind: "pick", team: team, year: yr, round: rd, id: team + "-" + yr + "-" + rd });
    });
  });
  return out;
}

// A pick's worth, in the same units as a player: a first two years out is a
// known quantity, a fourth-rounder three years out is close to noise.
export function pickValue(pick, thisYear) {
  const base = { 1: 13, 2: 8, 3: 5, 4: 3 }[pick.round] || 2;
  const out = pick.year - thisYear;
  return Math.round(base * Math.pow(0.82, Math.max(0, out)) * 10) / 10;
}
