import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Who is in the app right now, and how to read it without breaking the page.
 *
 * `last_seen_at` arrived with a migration, and a deploy can reach a browser
 * before its SQL reaches the database. Naming a column that is not there fails
 * the whole select — and the routes that read the league turn a failed select
 * into an empty list, so for the few minutes between the two the League tab
 * read as a league with no teams in it rather than as a league with nobody
 * online. It did exactly that once.
 *
 * So presence is asked for optionally, in one place rather than in each route
 * that wants it.
 */

/** Long enough to cover reading a page, short enough that "here" means here. */
export const PRESENT_MS = 5 * 60_000;

/** Whether a stamp counts as being about, right now. */
export function isPresent(lastSeenAt: string | null | undefined, now = Date.now()): boolean {
  if (!lastSeenAt) return false;
  const at = Date.parse(lastSeenAt);
  return Number.isFinite(at) && now - at < PRESENT_MS;
}

/**
 * A league's managers, with `last_seen_at` if the database has it.
 *
 * Asking again without the column costs one round trip in a window that
 * should never be open, and keeps the page on the screen throughout it.
 */
export async function readManagers<T>(
  db: SupabaseClient,
  leagueId: string,
  columns: string,
): Promise<{ data: (T & { last_seen_at?: string | null })[] | null }> {
  const withPresence = await db
    .from("managers")
    .select(`${columns}, last_seen_at`)
    .eq("league_id", leagueId)
    .order("slot");

  // Cast through unknown: the column list is built at runtime, so the typed
  // query builder cannot know what shape comes back and infers an error type
  // from the template string. The caller names the shape it asked for.
  if (!withPresence.error) {
    return { data: withPresence.data as unknown as (T & { last_seen_at?: string | null })[] };
  }

  console.warn("[presence] column not there yet, reading without it", withPresence.error.message);

  const plain = await db.from("managers").select(columns).eq("league_id", leagueId).order("slot");
  if (plain.error) console.error("[presence] could not read the managers", plain.error);

  return {
    data: (plain.data as unknown as (T & { last_seen_at?: string | null })[] | null) ?? null,
  };
}
