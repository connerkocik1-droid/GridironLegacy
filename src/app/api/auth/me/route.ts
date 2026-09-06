import { currentManager, duesNote, movesTabOpen } from "@/lib/session";
import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Who is signed in, if anyone. Used by the header and route guards.
 *
 * Goes through currentManager for the same reason the front door does: a
 * session with no franchise in this league is somebody who is not signed in,
 * however valid their cookie, and every guard built on this answer needs to be
 * told so rather than shown a header for a team that is not theirs.
 */
export async function GET() {
  if (!isConfigured()) return Response.json({ manager: null, configured: false, movesTab: false, duesNote: null });

  const manager = await currentManager();
  if (!manager) return Response.json({ manager: null, configured: true, movesTab: false, duesNote: null });

  const db = await serverClient();

  // Their own crest comes along, so the button in the corner has something to
  // draw without a second round trip. Everyone else's is fetched only by the
  // pages that draw the whole league.
  const { data: logo } = await db
    .from("team_logos")
    .select("image")
    .eq("manager_id", manager.id)
    .maybeSingle();

  // Whether the league has handed the fourth tab over to the transactions.
  // The layout already answers this from the server so the first frame is
  // right; this is what makes the tab change over for eleven managers who are
  // sitting in the app when the commissioner gives the command, rather than at
  // each of their next reloads.
  return Response.json({
    manager: { ...manager, logo: logo?.image ?? null },
    configured: true,
    movesTab: await movesTabOpen(manager.league_id),
    // What the league says about dues, if it says anything. The manager's own
    // dues_paid rides along on the manager itself, so the band on the home
    // page needs nothing else to decide whether it is for this person.
    duesNote: await duesNote(manager.league_id),
  });
}
