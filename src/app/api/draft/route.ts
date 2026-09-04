import { availablePlayers } from "@/lib/draft-pool";
import { maybeAutopick } from "@/lib/draft-autopick";
import { pickSecondsFor, readPickClock } from "@/lib/draft-clock";
import { MEDIA_BUCKET } from "@/lib/league-media";
import { isConfigured, serverClient, serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

const NOT_CONFIGURED = Response.json(
  { error: "The league database is not configured yet." },
  { status: 503 },
);

/**
 * Deletes the intro film once the draft is over.
 *
 * The database decides whether there is anything to do and hands back the
 * path, so twelve browsers polling at once produce one delete. Nothing here is
 * allowed to break the draft board: a storage service having a bad afternoon
 * costs the league some bytes, not its board.
 */
async function clearIntroVideo(
  db: Awaited<ReturnType<typeof serverClient>>,
  leagueId: string,
): Promise<void> {
  try {
    const { data: path, error } = await db.rpc("claim_intro_video_cleanup", {
      p_league_id: leagueId,
    });
    if (error || typeof path !== "string" || !path) return;

    // Only files under this league's own prefix, which is the same rule the
    // commissioner's own delete follows.
    if (!path.startsWith(`${leagueId}/`) || path.includes("..")) return;

    const admin = serviceClient();
    const { error: removed } = await admin.storage.from(MEDIA_BUCKET).remove([path]);

    // The claim cleared the reference before the delete was attempted, which
    // is what makes it a claim. If the delete then fails, the file would be
    // orphaned — costing exactly the storage this is meant to save, with
    // nothing left pointing at it to try again. So put it back and let the
    // next poll have another go.
    if (removed) {
      console.error("[draft] intro video delete failed, restoring the reference", removed);
      await restoreIntroVideo(admin, leagueId, path);
    }
  } catch (err) {
    console.error("[draft] could not clear the intro video", err);
  }
}

/** Undoes a claim whose delete did not go through. */
async function restoreIntroVideo(
  admin: ReturnType<typeof serviceClient>,
  leagueId: string,
  path: string,
): Promise<void> {
  try {
    const { data: league } = await admin
      .from("leagues")
      .select("settings")
      .eq("id", leagueId)
      .single();

    // Only if nothing else has claimed the slot since — a commissioner who
    // uploaded a new film in the meantime must not have it overwritten by the
    // corpse of the old one.
    const settings = { ...(league?.settings ?? {}) };
    if (settings.introVideoPath) return;

    settings.introVideoPath = path;
    settings.introVideo = admin.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;

    await admin.from("leagues").update({ settings }).eq("id", leagueId);
  } catch (err) {
    console.error("[draft] could not restore the intro video reference", err);
  }
}

/** The board, the clock, and who is on it. */
export async function GET() {
  if (!isConfigured()) return NOT_CONFIGURED;

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { data: me } = await db
    .from("managers")
    .select("id, slot, franchise, league_id, is_commissioner, ready, autodraft")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  const { data: league } = await db
    .from("leagues")
    .select("id, settings, draft_state, current_pick, pick_started_at, draft_at, lottery_order, lottery_at")
    .eq("id", me.league_id)
    .single();
  if (!league) return Response.json({ error: "League not found" }, { status: 404 });

  // The film is the largest thing this league stores and nobody watches it
  // twice. The draft board is where somebody is standing when the draft ends,
  // so this is where it gets cleaned up. The guard means the call is made on
  // one poll in the life of a league rather than on all of them.
  if (league.draft_state === "complete" && league.settings?.introVideoPath) {
    void clearIntroVideo(db, me.league_id);
  }

  const { data: picks } = await db
    .from("draft_picks")
    .select("overall, round, manager_id, player_name, picked_at")
    .eq("league_id", me.league_id)
    .order("overall");

  // pin_hash is read and never sent: it is the only thing that says whether a
  // franchise has an owner, and the lottery wants to put a first name beside
  // the ones that do.
  const { data: managers } = await db
    .from("managers")
    .select("id, slot, franchise, name, pin_hash, ready, autodraft")
    .eq("league_id", me.league_id);

  // Who holds whom, not just who is gone: the autopick fallback is measured
  // against the roster of the manager on the clock, so it needs both.
  const { data: rostered } = await db
    .from("roster_slots")
    .select("player_name, manager_id")
    .eq("league_id", me.league_id);

  // This manager's own list, in their own order. The row policy on draft_queue
  // is what keeps it theirs; nothing here has to check.
  const { data: queued } = await db
    .from("draft_queue")
    .select("player_name, rank")
    .eq("league_id", me.league_id)
    .eq("manager_id", me.id)
    .order("rank");

  const taken = new Set((rostered ?? []).map((r) => r.player_name));
  const available = availablePlayers(taken);

  const onTheClock = (picks ?? []).find((p) => p.overall === league.current_pick) ?? null;

  // The clock is the round's, not the league's: ninety seconds is right for
  // the first round and absurd for the fourteenth. The client counts down from
  // this number, so what it draws is what the database will act on.
  const clock = readPickClock(league.settings);
  const pickSeconds = pickSecondsFor(clock, onTheClock?.round ?? 1);

  // The pick nobody is there to make, made from whichever browser noticed. The
  // cron is still behind this; it is a minute coarse, and the room polls every
  // five seconds. Scheduled for after this response, so nobody waits on it.
  const onClockManager = (managers ?? []).find((m) => m.id === onTheClock?.manager_id);
  maybeAutopick({
    leagueId: me.league_id,
    state: league.draft_state,
    pickStartedAt: league.pick_started_at,
    settings: league.settings ?? {},
    onTheClock: onTheClock
      ? { manager_id: onTheClock.manager_id, round: onTheClock.round, overall: onTheClock.overall }
      : null,
    autodraft: onClockManager?.autodraft === true,
    rostered: (rostered ?? []) as { player_name: string; manager_id: string }[],
    totalPicks: (picks ?? []).length,
    teams: (managers ?? []).length,
  });

  return Response.json({
    me,
    league: {
      state: league.draft_state,
      currentPick: league.current_pick,
      // The clock is the server's. Clients count down from this instant so
      // twelve browsers cannot drift apart and skip someone.
      pickStartedAt: league.pick_started_at,
      pickSeconds,
      // The whole ladder as well as this round's rung, so the room can say
      // what the clock does next rather than only what it is now.
      pickClock: clock,
      serverNow: new Date().toISOString(),
      draftAt: league.draft_at,
      // The order the lottery drew, and the instant it began. Every browser
      // animates the reveal from that instant rather than from when its own
      // page opened, so twelve managers watch the same spin land together.
      lotteryOrder: (league.lottery_order ?? null) as string[] | null,
      lotteryAt: league.lottery_at ?? null,
      // How many rounds get the full-screen reveal. Past these the board just
      // updates, because ten seconds a pick stops being a thrill by round four.
      cinematicRounds: Number(league.settings?.cinematicRounds ?? 3),
      // Played once, by everyone waiting, the moment the countdown runs out.
      introVideo:
        typeof league.settings?.introVideo === "string" ? league.settings.introVideo : null,
    },
    onTheClock,
    myTurn: onTheClock?.manager_id === me.id,
    picks: picks ?? [],
    managers: (managers ?? []).map((m) => ({
      id: m.id,
      slot: m.slot,
      franchise: m.franchise,
      // Null for a franchise nobody has claimed. "Open" is a placeholder, not
      // somebody's name, and the draft room should not put it beside a crest
      // as though it were.
      name: m.pin_hash ? m.name : null,
      ready: m.ready,
      autodraft: m.autodraft,
    })),
    available,
    queue: (queued ?? []).map((q) => q.player_name as string),
  });
}

/** Make the pick that is on the clock. */
export async function POST(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { data: me } = await db
    .from("managers")
    .select("id, league_id")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  let body: { player?: unknown; forManager?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const playerName = typeof body.player === "string" ? body.player : "";
  if (!playerName) return Response.json({ error: "player is required" }, { status: 400 });

  const { data, error } = await db.rpc("make_pick", {
    p_league_id: me.league_id,
    p_player_name: playerName,
    p_manager_id: typeof body.forManager === "string" ? body.forManager : null,
  });

  if (error) {
    // Two managers can click the same player in the same second. The loser
    // gets told cleanly rather than seeing a duplicate appear.
    const conflict = error.code === "23505" || error.message.includes("already");
    return Response.json({ error: error.message }, { status: conflict ? 409 : 400 });
  }

  return Response.json(data);
}
