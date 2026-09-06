import { isConfigured, serverClient } from "@/lib/supabase";

export interface SessionManager {
  id: string;
  slot: string;
  name: string;
  franchise: string;
  /** Where to email them, or null if they have not given one. */
  email?: string | null;
  email_notices?: boolean;
  league_id: string;
  is_commissioner: boolean;
  ready: boolean;
  /** Whether the commissioner has marked this franchise's dues settled. */
  dues_paid?: boolean;
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
      .select("id, slot, name, franchise, league_id, is_commissioner, ready, email, email_notices, dues_paid")
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

/**
 * Whether this league has handed the fourth tab over to the transactions.
 *
 * The bottom bar's fourth slot is the draft room until the commissioner says
 * otherwise and the Moves tab afterwards. It is deliberately NOT read off
 * draft_state: a draft can read "complete" before a league is ready to call
 * the offseason over — a rehearsal, a reset, a resize that flips it back —
 * and the tab changing under eleven managers because a state machine moved is
 * how somebody loses the draft room on the morning of the draft. So it is a
 * command, given once in the league office, and nothing else moves it.
 *
 * Read from the server, in the layout, for the same reason "signed in" is: a
 * tab decided only in the browser is a tab that is missing on a cold
 * home-screen launch, which is the bug the PWA had for a week.
 *
 * Unreachable database, no league, no LEAGUE_ID: false, so the draft room
 * stays. Losing the draft room on draft night is much the worse of the two.
 */
export async function movesTabOpen(managerLeagueId?: string): Promise<boolean> {
  return (await leagueSettings(managerLeagueId))?.movesTab === true;
}

/**
 * What the league says about dues, or null if it says nothing.
 *
 * Free text, and it is both the message and the switch: no note, no notice,
 * for anybody, ever. A league that does not collect dues never sees a word
 * about them, and a brand-new league does not greet eleven people with a bill
 * nobody has set.
 */
export async function duesNote(managerLeagueId?: string): Promise<string | null> {
  const note = (await leagueSettings(managerLeagueId))?.duesNote;
  return typeof note === "string" && note.trim() ? note.trim() : null;
}

/** The league's settings blob, or null if it cannot be read. */
async function leagueSettings(
  managerLeagueId?: string,
): Promise<Record<string, unknown> | null> {
  if (!isConfigured()) return null;

  try {
    const db = await serverClient();
    const leagueId = managerLeagueId ?? process.env.LEAGUE_ID;
    if (!leagueId) return null;

    const { data } = await db
      .from("leagues")
      .select("settings")
      .eq("id", leagueId)
      .maybeSingle();

    return (data?.settings as Record<string, unknown> | null) ?? null;
  } catch {
    return null;
  }
}
