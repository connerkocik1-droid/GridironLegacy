import { isConfigured, serverClient } from "@/lib/supabase";

export interface SessionManager {
  id: string;
  slot: string;
  name: string;
  franchise: string;
  league_id: string;
  is_commissioner: boolean;
  ready: boolean;
}

/**
 * The franchise the person at the other end of this request holds, if any.
 *
 * Being signed in is not the same thing as having a Supabase session, and the
 * difference is what the front door kept getting wrong. A session says an auth
 * user exists. It says nothing about whether that user still holds a franchise
 * in the league this deployment serves — and there are three ordinary ways for
 * those to come apart:
 *
 *   * The commissioner released the franchise, or reset the league with
 *     "release franchises" ticked. Both null the manager's auth_user_id and
 *     neither can reach into somebody's browser to take the cookie back.
 *   * The seed was run twice, leaving a second league. The session resolves to
 *     a franchise in the old one while LEAGUE_ID points at the new.
 *   * Sign-up created the auth user and then failed before linking a franchise.
 *
 * In every one of those the session is real, getUser() says yes, and the
 * manager is gone. A front door that asks only "is there a session" then shows
 * the league to somebody with no team in it, and — because the sign-in page is
 * what that same door would otherwise be — leaves them no way back.
 *
 * So: signed in means holding a franchise in THIS league. Anything else reads
 * as signed out, which puts the sign-in page back in front of them, and signing
 * in replaces the dead session with a live one.
 */
export async function currentManager(): Promise<SessionManager | null> {
  if (!isConfigured()) return null;

  try {
    const db = await serverClient();
    const {
      data: { user },
    } = await db.auth.getUser();
    if (!user) return null;

    let query = db
      .from("managers")
      .select("id, slot, name, franchise, league_id, is_commissioner, ready")
      .eq("auth_user_id", user.id);

    // Scoped when the deployment names its league, which it always does in
    // production. Left unscoped otherwise rather than refusing everybody: a
    // deployment with no LEAGUE_ID has bigger problems than this, and they are
    // reported where they can be acted on.
    const leagueId = process.env.LEAGUE_ID;
    if (leagueId) query = query.eq("league_id", leagueId);

    const { data } = await query.maybeSingle();
    return (data as SessionManager | null) ?? null;
  } catch {
    // A database that cannot be reached is not a licence to let somebody in.
    return null;
  }
}
