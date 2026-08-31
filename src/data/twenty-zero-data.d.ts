/** One player's best season inside an era, as scored for 20-0 mode. */
export interface Season {
  /** Name. */
  n: string;
  /** Franchise abbreviation. */
  t: string;
  /** The season's year. */
  yr: number;
  /** Index into ERA_LABELS. */
  era: number;
  /** Pool key: QB, RB, WR, TE, DL, LB or DB. */
  pos: string;
  /**
   * 1-100 within this player's own position, so a safety and a quarterback are
   * measured against their own peers rather than against each other.
   */
  sc: number;
  line: string;
  line2: string;
}

export const ERA_LABELS: string[];
export const POOLS: Record<string, Season[]>;
export const QB_POOL: Season[];
