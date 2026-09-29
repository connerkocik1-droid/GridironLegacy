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

/**
 * When somebody was last in the app, said two ways.
 *
 * A grey dot answers "is Alpha here?" and nothing else. For eleven of twelve
 * rows that is the whole answer, and it is the least interesting one — a
 * manager who was here an hour ago and one who has not opened the app since
 * the draft look identical, and they are not remotely the same thing. The
 * difference is what tells you whether a trade offer will be seen tonight or
 * whether somebody has stopped playing.
 *
 * Two forms because the places this goes are dense tables: `short` sits beside
 * the dot in a couple of characters, and `long` is the sentence the tooltip
 * and the screen reader get. Anything past a week stops being a duration and
 * becomes a date — "23d" is arithmetic nobody does in their head.
 *
 * Null when there is no stamp at all, which is a manager who has never opened
 * the app since presence was added rather than one who has been away a long
 * time. The dot already says they are not here; inventing a duration for them
 * would be making it up.
 */
export function lastActive(
  lastSeenAt: string | null | undefined,
  now = Date.now(),
): { short: string; long: string } | null {
  if (!lastSeenAt) return null;
  const at = Date.parse(lastSeenAt);
  if (!Number.isFinite(at)) return null;

  const mins = (now - at) / 60_000;
  // A clock that is behind the server's would otherwise read "-3m ago".
  if (mins < 1) return { short: "now", long: "Last active just now" };

  const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? "" : "s"} ago`;

  if (mins < 60) {
    const n = Math.round(mins);
    return { short: `${n}m`, long: `Last active ${plural(n, "minute")}` };
  }
  if (mins < 60 * 24) {
    const n = Math.round(mins / 60);
    return { short: `${n}h`, long: `Last active ${plural(n, "hour")}` };
  }
  if (mins < 60 * 24 * 7) {
    const n = Math.round(mins / (60 * 24));
    return { short: `${n}d`, long: `Last active ${plural(n, "day")}` };
  }

  const on = new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return { short: on, long: `Last active ${on}` };
}
