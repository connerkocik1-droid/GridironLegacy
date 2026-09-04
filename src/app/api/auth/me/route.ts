import { currentManager } from "@/lib/session";
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
  if (!isConfigured()) return Response.json({ manager: null, configured: false });

  const manager = await currentManager();
  if (!manager) return Response.json({ manager: null, configured: true });

  const db = await serverClient();

  // Their own crest comes along, so the button in the corner has something to
  // draw without a second round trip. Everyone else's is fetched only by the
  // pages that draw the whole league.
  const { data: logo } = await db
    .from("team_logos")
    .select("image")
    .eq("manager_id", manager.id)
    .maybeSingle();

  return Response.json({
    manager: { ...manager, logo: logo?.image ?? null },
    configured: true,
  });
}
