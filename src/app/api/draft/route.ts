import { POOL } from "@/data/league-data";
import { byDynastyAdp, valueOf } from "@/lib/dynasty";
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
    .select("id, slot, franchise, league_id, is_commissioner, ready")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  const { data: league } = await db
    .from("leagues")
    .select("id, settings, draft_state, current_pick, pick_started_at, draft_at")
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

  const { data: managers } = await db
    .from("managers")
    .select("id, slot, franchise, ready")
    .eq("league_id", me.league_id);

  const { data: rostered } = await db
    .from("roster_slots")
    .select("player_name")
    .eq("league_id", me.league_id);

  const taken = new Set((rostered ?? []).map((r) => r.player_name));
  // Ordered as a dynasty league takes them: the consensus board, moved by age.
  // Sorting has to come before the slice, or the two hundred names sent to the
  // room would be the redraft two hundred with a dynasty order inside them.
  const available = POOL.filter((p) => !taken.has(p.n))
    .map((p) => ({ player: p, value: valueOf(p) }))
    .sort((a, b) => byDynastyAdp(a.value, b.value))
    .slice(0, 200)
    .map(({ player: p, value }) => ({
      name: p.n,
      position: p.p,
      team: p.t,
      adp: p.adp,
      dynastyAdp: value.dynastyAdp,
      age: value.age,
      modifier: value.modifier,
      posRank: p.posRank,
      bye: p.bye,
    }));

  const onTheClock = (picks ?? []).find((p) => p.overall === league.current_pick) ?? null;
  const pickSeconds = Number(league.settings?.pickSeconds ?? 90);

  return Response.json({
    me,
    league: {
      state: league.draft_state,
      currentPick: league.current_pick,
      // The clock is the server's. Clients count down from this instant so
      // twelve browsers cannot drift apart and skip someone.
      pickStartedAt: league.pick_started_at,
      pickSeconds,
      serverNow: new Date().toISOString(),
      draftAt: league.draft_at,
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
    managers: managers ?? [],
    available,
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
