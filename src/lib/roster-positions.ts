import { player } from "./roster";
import type { StatLine } from "./scoring";
import type { serviceClient } from "./supabase";

type Db = ReturnType<typeof serviceClient>;

/**
 * Telling the database what everybody plays.
 *
 * Best ball fills the starting slots by itself, which means the database has to
 * know that a name is a running back — something it has never needed before,
 * because a manager used to say so by dragging him into a slot. The app is the
 * only place that knows, so the app writes it down.
 *
 * Two sources, in order. The draft pool carries a declared position for
 * everybody who was ever draftable, which is nearly everybody and costs
 * nothing. A waiver pickup from outside that pool is not in it, so the second
 * source is the box score ESPN just handed us, where the position is the one
 * the league's own scoring already used to write his stat line. Neither is
 * inferred from what a player did on the field.
 */

/** What the league calls each rostered player, best source first. */
export function positionsFor(
  rostered: Iterable<string>,
  scored?: Map<string, { line: StatLine }> | null,
): Map<string, string> {
  const out = new Map<string, string>();

  for (const name of rostered) {
    const pooled = player(name)?.p;
    if (pooled) {
      out.set(name, pooled);
      continue;
    }

    // Already in the league's vocabulary: scoreGameDetail puts every position
    // through toSlotPosition before it reaches a stat line, so a kicker is a K
    // here rather than ESPN's PK.
    const stated = scored?.get(name)?.line?.position;
    if (stated) out.set(name, stated);
  }

  return out;
}

/**
 * Writes them down, if any of them changed.
 *
 * Deliberately unable to fail loudly. A position that does not get recorded
 * costs that player his slot for one refresh and the next one puts him back,
 * so this is never worth failing a score write over — but it is worth a line
 * in the log, because a whole roster missing positions is a lineup of nobody.
 */
export async function syncRosterPositions(
  db: Db,
  leagueId: string,
  positions: Map<string, string>,
): Promise<number> {
  if (!positions.size) return 0;

  const names = [...positions.keys()];
  const { data, error } = await db.rpc("sync_roster_positions", {
    p_league_id: leagueId,
    p_names: names,
    p_positions: names.map((n) => positions.get(n)!),
  });

  if (error) {
    // A missing function means migration 0036 has not been run yet.
    console.error("[live] could not record roster positions", error.message);
    return 0;
  }

  return typeof data === "number" ? data : 0;
}

/**
 * Telling the database which club each player belongs to.
 *
 * The same reasoning as the positions above, for the same reason: the app has
 * always known this and the database never did. What needs it now is the
 * kickoff lock — "has his game started" cannot be answered without knowing
 * whose game to look at, and the answer has to be settled inside the same
 * function that makes the move, because every one of those functions is
 * callable by any browser holding a session.
 *
 * The whole pool rather than one league's rosters. A free agent is exactly the
 * case the lock exists for, and he is on nobody's roster by definition.
 *
 * Unable to fail loudly, like its neighbour: migration 0045 seeds this table
 * with the pool as it stood, so a sync that does not happen leaves the rule
 * working on slightly older clubs rather than not working at all.
 */
export async function syncNflPlayers(db: Db, pool: { n: string; t: string; p: string }[]): Promise<number> {
  if (!pool.length) return 0;

  const { data, error } = await db.rpc("sync_nfl_players", {
    p_names: pool.map((x) => x.n),
    p_teams: pool.map((x) => x.t),
    p_positions: pool.map((x) => x.p),
  });

  if (error) {
    console.warn("[nfl-players] could not sync the club map", error.message);
    return 0;
  }
  return Number(data ?? 0);
}
