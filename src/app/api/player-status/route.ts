import { fetchInjuries } from "@/lib/espn";
import { normalizeName } from "@/lib/player-names";
import { toHealth, type Health } from "@/lib/health";

/**
 * Who is fit, for every page that shows a player's name.
 *
 * Shared and cached rather than per-manager: an injury report is the same for
 * everybody, and a page with forty names on it should cost one request, not
 * forty. Keyed by the normalised name so the lookup works from any spelling —
 * the same key the scorer matches ESPN's box scores on.
 *
 * A failure returns an empty report rather than an error. Every player then
 * reads as fit, which is what the app assumed before any of this existed, and
 * is a great deal better than a page that will not load because somebody
 * else's API is having an afternoon.
 */
export interface Reported {
  status: Health;
  detail: string;
  note: string;
}

/**
 * The report, keyed by the name every other table is keyed by.
 *
 * An entry whose word we cannot read is dropped rather than guessed at. This
 * used to turn every one of them into "questionable", on the reasoning that
 * everybody on the report is on it for a reason. They are — but ESPN's report
 * is the whole league's, hundreds of names deep, and it carries entries with
 * an empty status, a practice note, or a phrase we have never seen. All of
 * them came out of here wearing a Q, which is how a badge meant for two names
 * a week ended up on a page's worth of them.
 *
 * Being on a list is not a diagnosis.
 */
export function reportFrom(injuries: { name: string; status: string; detail?: string }[]): Record<string, Reported> {
  const statuses: Record<string, Reported> = {};

  for (const entry of injuries) {
    const key = normalizeName(entry.name);
    if (!key) continue;

    const status = toHealth(entry.status);
    if (status === "active") continue;

    statuses[key] = { status, detail: entry.status || "", note: entry.detail || "" };
  }

  return statuses;
}

export async function GET() {
  try {
    const statuses = reportFrom(await fetchInjuries());

    return Response.json(
      { statuses, fetchedAt: new Date().toISOString() },
      // Fifteen minutes. An injury report moves on Wednesday, Thursday and
      // Friday afternoons, not by the second.
      { headers: { "cache-control": "public, max-age=900, stale-while-revalidate=3600" } },
    );
  } catch (err) {
    console.error("[player-status] injuries unavailable", err);
    return Response.json({ statuses: {}, fetchedAt: null, error: true });
  }
}
