import {
  BENCH,
  DEFENSE,
  KICK,
  PASS,
  RECV,
  ROLES,
  RUSH,
  STARTERS,
  byeOf,
  find,
  type Player,
  type Position,
} from "@/data/league-data";
import { SCORING_RULES } from "./scoring";
import { DEFAULT_SCORING, RECEPTION_POINTS, type ScoringFormat } from "./scoring-format";

export interface LeagueShape {
  starters?: Partial<Record<Position | "FLEX", number>>;
  bench?: number;
  ir?: number;
  [key: string]: unknown;
}

const SKILL: Position[] = ["RB", "WR", "TE"];
const DEPTH_POSITIONS: Position[] = ["QB", "RB", "WR", "TE", "K", "D/ST"];

/**
 * A rostered player who never entered the draftable pool still needs a position
 * and a team, which the roster tables carry in their "QB · WSH" label.
 */
export function player(name: string): Player | null {
  const pooled = find(name);
  if (pooled) return pooled;

  const seed = [...STARTERS.flat(), ...BENCH].find((x) => x.n === name);
  if (!seed) return null;

  const [pos, team] = (seed.pt ?? "").split(" · ");
  return {
    n: name,
    p: (pos === "DST" ? "D/ST" : pos) as Position,
    t: team ?? "",
    arch: "",
    adp: 999,
    bye: 0,
    q: false,
  } as Player;
}

/**
 * Pre-season week one, so this is a season-shape estimate rather than a live
 * number: last year's per-game fantasy scoring where the export has it,
 * otherwise a consensus-ADP curve.
 *
 * In the league's own format, and by the scorer's own rules. The arithmetic
 * used to be written out here a second time with half a point a catch fixed
 * into it, so when the league went to full PPR the scores followed and every
 * projection stayed behind — a receiver catching seven a game was projected
 * three and a half points short, every week, on every screen that projects.
 * Omitting the format means the league default, which is what the scorer
 * falls back to as well.
 */
export function proj(name: string, format: ScoringFormat = DEFAULT_SCORING): number {
  const p = player(name);
  if (!p) return 0;

  if (KICK[name]) return Number(KICK[name].ppg);
  if (p.p === "D/ST" && DEFENSE[p.t]) return Number(DEFENSE[p.t].ppg);

  const pa = PASS[name];
  const ru = RUSH[name];
  const re = RECV[name];
  const gp = Math.max(Number(pa?.gp ?? 0), Number(ru?.gp ?? 0), Number(re?.gp ?? 0));

  if (gp) {
    const R = SCORING_RULES;
    let pts = 0;
    if (pa) {
      pts += Number(pa.yds) / R.passYardsPer + Number(pa.td) * R.passTd + Number(pa.int) * R.interception;
    }
    if (ru) pts += Number(ru.yds) / R.rushRecYardsPer + Number(ru.td) * R.rushRecTd;
    if (re) {
      pts +=
        Number(re.yds) / R.rushRecYardsPer +
        Number(re.td) * R.rushRecTd +
        Number(re.rec) * RECEPTION_POINTS[format];
    }
    return Math.round((pts / gp) * 10) / 10;
  }

  return Math.round(Math.max(2, 26 - Math.log(Math.max(1, p.adp)) * 4) * 10) / 10;
}

export type FlagKind = "inj" | "bye" | "cond";
export interface Flag {
  label: string;
  kind: FlagKind;
}

/**
 * A bye week, or a conditional depth-chart role.
 *
 * Fitness used to be here too, as a "Q" drawn from the draft pool's own
 * questionable flag. It is not any more: the health badge beside every name
 * carries it, from today's injury report rather than from a snapshot taken
 * when the pool was built. Two badges saying Q on the same row was the
 * visible half of the problem; the invisible half was that this one could not
 * say OUT, IR or SUS at all.
 */
export function flagsFor(name: string): Flag[] {
  const p = player(name);
  if (!p) return [];

  const out: Flag[] = [];

  const bye = byeOf(p);
  if (bye) out.push({ label: `BYE ${bye}`, kind: "bye" });

  const role = ROLES[name];
  if (role && /\*/.test(role.role)) out.push({ label: role.role, kind: "cond" });

  return out;
}

export function flagColor(kind: FlagKind): string {
  if (kind === "inj") return "var(--warn)";
  if (kind === "cond") return "var(--accent-link)";
  return "var(--text-dim)";
}

/**
 * What each slot will accept. FLEX takes only the skill positions the league
 * actually starts, so a league that drops tight ends does not offer them a
 * flex spot.
 */
export function eligible(slot: string, pos: Position, league?: LeagueShape | null): boolean {
  const starters = league?.starters;
  const flex = starters ? SKILL.filter((p) => (starters[p] ?? 0) > 0) : SKILL;

  const map: Record<string, Position[]> = {
    QB: ["QB"],
    RB: ["RB"],
    WR: ["WR"],
    TE: ["TE"],
    K: ["K"],
    "D/ST": ["D/ST"],
    FLEX: flex.length ? flex : SKILL,
  };

  return (map[slot] ?? [slot as Position]).includes(pos);
}

/** What the roster should hold at each position, from the league's own shape. */
export function depthTarget(league?: LeagueShape | null): Record<string, number> {
  if (!league?.starters) return { QB: 3, RB: 7, WR: 9, TE: 3, K: 1, "D/ST": 1 };

  const bench = league.bench ?? 14;
  const flex = league.starters.FLEX ?? 0;
  const out: Record<string, number> = {};

  for (const pos of DEPTH_POSITIONS) {
    const start = league.starters[pos] ?? 0;
    if (!start) {
      out[pos] = 0;
    } else if (pos === "K" || pos === "D/ST") {
      out[pos] = start;
    } else {
      const share = pos === "QB" ? 0 : flex / 3;
      out[pos] = start + Math.max(1, Math.round((start + share) * (bench / 8)));
    }
  }

  return out;
}
