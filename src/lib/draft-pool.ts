import { POOL } from "@/data/league-data";

export interface AvailablePlayer {
  name: string;
  position: string;
  team: string;
  adp: number;
  posRank: string;
  bye: number;
}

/**
 * Everybody still undrafted.
 *
 * This used to hand back the first two hundred by ADP, which sounds like a
 * sensible cap and is not one. The draft room filters by position in the
 * browser, so a player the server leaves out is a player nobody in the league
 * can draft — and kickers and defences carry the latest ADP there is. The top
 * two hundred held two kickers and no defences at all, in a draft of two
 * hundred and eighty-eight picks.
 *
 * So: no cap. The whole pool is about forty kilobytes of JSON, which is a
 * price worth paying once every five seconds for a couple of hours a year in
 * exchange for a draft where every position exists.
 */
export function availablePlayers(taken: Set<string>): AvailablePlayer[] {
  return POOL.filter((p) => !taken.has(p.n)).map((p) => ({
    name: p.n,
    position: p.p,
    team: p.t,
    adp: p.adp,
    posRank: p.posRank,
    bye: p.bye,
  }));
}
