import { toHealth } from "./health";
import { NameIndex } from "./player-names";

/**
 * Writing the injury report into the database.
 *
 * Extracted because two callers need it and they must not drift. The nightly
 * cron is the obvious one. The other is a manager pressing "Send to IR Slot":
 * that route has already fetched the report to decide whether the move is
 * allowed, and the RPC it is about to call decides the same question from
 * nfl_players.injury_status — so unless the table is brought level first, a
 * move the route has just approved can be refused by the database on the
 * strength of a column that is a night old.
 *
 * Two rules that are easy to get wrong and expensive to get wrong:
 *
 * The whole report, never a subset. sync_player_health clears the designation
 * of every player it is *not* handed — which is correct for a full report and
 * catastrophic for a partial one. Handing it a single name to refresh would
 * mark every other injured man in the league fit.
 *
 * An unreadable word is not a diagnosis. An entry whose status does not map to
 * one of the five is dropped rather than written, because a designation
 * somebody acts on should not be a guess at what ESPN meant.
 */

export interface ReportEntry {
  name: string;
  status: string;
  detail?: string;
}

export interface SyncResult {
  /** How many rows the database actually changed. */
  changed: number;
  /** Report entries whose name matched nobody in the player list. */
  unmatched: number;
  /** Entries that reduced to "active", which are not written. */
  reported: number;
}

/**
 * Just enough of the Supabase client for this, so a test can hand it a stub.
 *
 * PromiseLike rather than Promise: a Supabase query is a builder that is
 * thenable but is not a Promise, so the narrower type does not fit it.
 */
interface Db {
  from(table: string): {
    select(cols: string): PromiseLike<{ data: { name: string }[] | null; error: unknown }>;
  };
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * Put the report into the database, and say what happened.
 *
 * Returns rather than throws on a database error: both callers have something
 * better to do than fail. The cron reports it; the stash route carries on and
 * lets the RPC give the manager a real answer.
 */
export async function syncReport(db: Db, entries: readonly ReportEntry[]): Promise<SyncResult> {
  const { data: known } = await db.from("nfl_players").select("name");

  // ESPN and the pool spell a handful of men differently — a suffix, an
  // initial, a middle name. Same index the scorer matches box scores with.
  const index = new NameIndex((known ?? []).map((row) => row.name));

  const names: string[] = [];
  const statuses: string[] = [];
  const details: string[] = [];
  let unmatched = 0;

  for (const entry of entries) {
    const status = toHealth(entry.status);
    if (status === "active") continue;

    const name = index.lookup(entry.name);
    if (!name) {
      unmatched += 1;
      continue;
    }

    names.push(name);
    statuses.push(status);
    details.push(entry.detail || entry.status || "");
  }

  // An empty report clears nobody — the database refuses it too, but there is
  // no reason to make the round trip to be told so.
  if (!names.length) return { changed: 0, unmatched, reported: 0 };

  const { data, error } = await db.rpc("sync_player_health", {
    p_names: names,
    p_statuses: statuses,
    p_details: details,
  });

  if (error) return { changed: 0, unmatched, reported: names.length };
  return { changed: Number(data ?? 0), unmatched, reported: names.length };
}
