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
export async function GET() {
  try {
    const injuries = await fetchInjuries();
    const statuses: Record<string, { status: Health; detail: string; note: string }> = {};

    for (const entry of injuries) {
      const key = normalizeName(entry.name);
      if (!key) continue;

      const status = toHealth(entry.status);
      // Everybody on the report is on it for a reason; one whose word we do
      // not recognise is still worth showing as questionable rather than
      // silently reading as fit.
      const resolved: Health = status === "active" ? "questionable" : status;

      statuses[key] = { status: resolved, detail: entry.status || "", note: entry.detail || "" };
    }

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
