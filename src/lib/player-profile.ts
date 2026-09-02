import { POOL, find, headshot, logo, type Player } from "@/data/league-data";
import { POOLS, ERA_LABELS, type Season } from "@/data/twenty-zero-data";
import { normalizeName } from "./player-names";

/**
 * Everything the app knows about one player, gathered.
 *
 * Deliberately built from what is already here rather than from a new feed.
 * The draft pool carries who he is — position, team, bye, where the market has
 * him, and a paragraph of why. The 20-0 data carries two and a half thousand
 * real NFL seasons through 2025, which is where the actual football goes. The
 * league's own player_scores carry what he has done for whoever holds him.
 *
 * Only fitness comes from outside, because only fitness changes on a Wednesday
 * and there is nowhere in here it could have been kept.
 */

export interface CareerSeason {
  year: number;
  team: string;
  position: string;
  /** ESPN-style line, as the 20-0 export wrote it. */
  line: string;
  line2: string;
  /** Which era of the 20-0 pool this season sat in. */
  era: string;
}

export interface PlayerProfile {
  name: string;
  found: boolean;
  position: string;
  team: string;
  bye: number | null;
  headshot: string;
  teamLogo: string;

  /** Where the market had him, when the pool was built. */
  adp: number | null;
  posRank: string | null;
  rostered: number | null;

  /** The pool's one-line characterisation, and its paragraph. */
  archetype: string | null;
  insight: string | null;

  /**
   * Last year, and only last year.
   *
   * The historical pool reaches back to 2002. A profile is read while deciding
   * something this week, and a man's 2014 season has no bearing on that — so
   * the page shows the season before this one and nothing else.
   */
  career: CareerSeason[];
}

/** The year the profile shows beside the current one. */
const LAST_SEASON = 2025;

/** The one earlier season worth showing, if the pool holds it. */
function careerOf(name: string): CareerSeason[] {
  const key = normalizeName(name);
  const seen = new Set<string>();
  const out: CareerSeason[] = [];

  for (const seasons of Object.values(POOLS)) {
    for (const s of seasons as Season[]) {
      if (normalizeName(s.n) !== key) continue;
      if (s.yr !== LAST_SEASON) continue;

      // The pool holds a player's best season per era, so the same year can
      // appear twice when two eras overlap it. One row per year.
      const id = `${s.yr}-${s.t}`;
      if (seen.has(id)) continue;
      seen.add(id);

      out.push({
        year: s.yr,
        team: s.t,
        position: s.pos,
        line: s.line,
        line2: s.line2,
        era: ERA_LABELS[s.era] ?? "",
      });
    }
  }

  return out.sort((a, b) => b.year - a.year);
}

/**
 * The profile for a name, whether or not the pool has ever heard of it.
 *
 * A player claimed off waivers who was never in the draftable five hundred
 * still gets a page — it says what little is known and does not pretend the
 * rest. `found` is what the page reads to decide how much to promise.
 */
export function profileFor(name: string): PlayerProfile {
  const pooled: Player | null = find(name) ?? null;
  const career = careerOf(name);

  return {
    name: pooled?.n ?? name,
    found: Boolean(pooled) || career.length > 0,
    position: pooled?.p ?? career[0]?.position ?? "",
    team: pooled?.t ?? career[0]?.team ?? "",
    bye: pooled?.bye ?? null,
    headshot: headshot(pooled?.n ?? name),
    teamLogo: logo(pooled?.t ?? career[0]?.team ?? ""),
    adp: pooled?.adp ?? null,
    posRank: pooled?.posRank ?? null,
    rostered: pooled?.rost ?? null,
    archetype: pooled?.arch ?? null,
    insight: pooled?.ins ?? null,
    career,
  };
}

/** The league's own spelling of a name typed into a URL. */
export function resolvePlayerName(typed: string): string {
  const key = normalizeName(typed);
  const match = POOL.find((p) => normalizeName(p.n) === key);
  return match?.n ?? typed;
}
