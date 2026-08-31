import { isConfigured, serverClient } from "@/lib/supabase";
import { checkVideoSrc } from "@/lib/video-src";

export const dynamic = "force-dynamic";

const NOT_CONFIGURED = Response.json(
  { error: "The league database is not configured yet." },
  { status: 503 },
);

/** The league as the commissioner sees it: size, settings, and who has signed up. */
export async function GET() {
  if (!isConfigured()) return NOT_CONFIGURED;

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { data: me } = await db
    .from("managers")
    .select("id, slot, league_id, is_commissioner")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  const { data: league } = await db
    .from("leagues")
    .select(
      "id, name, season, settings, draft_state, current_pick, commissioner_slot, draft_at, lottery_order",
    )
    .eq("id", me.league_id)
    .single();

  const { data: managers } = await db
    .from("managers")
    .select("id, slot, name, franchise, pin_hash, is_commissioner, division")
    .eq("league_id", me.league_id)
    .order("slot");

  const { data: picks } = await db
    .from("draft_picks")
    .select("overall, player_name")
    .eq("league_id", me.league_id);

  const made = (picks ?? []).filter((p) => p.player_name).length;

  return Response.json({
    isCommissioner: me.is_commissioner,
    league,
    // Never send the hash, only whether the franchise is spoken for.
    managers: (managers ?? []).map((m) => ({
      id: m.id,
      slot: m.slot,
      name: m.name,
      franchise: m.franchise,
      division: m.division,
      claimed: m.pin_hash != null,
      isCommissioner: m.is_commissioner,
    })),
    board: { picks: picks?.length ?? 0, made },
    // Once a pick is made the league size is fixed, because the board would
    // have to be renumbered under picks that already exist.
    canResize: made === 0,
  });
}

/** Change the league size. Adds open slots, or removes unclaimed empty ones. */
export async function PATCH(req: Request) {
  if (!isConfigured()) return NOT_CONFIGURED;

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { data: me } = await db
    .from("managers")
    .select("league_id, is_commissioner")
    .eq("auth_user_id", user.id)
    .single();
  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });

  let body: {
    teams?: unknown;
    rounds?: unknown;
    draftAt?: unknown;
    introVideo?: unknown;
    pickSeconds?: unknown;
    cinematicRounds?: unknown;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  // The date the countdown counts to. Null clears it, which is how a league
  // says "no date yet" rather than counting to the epoch.
  if (body.draftAt !== undefined) {
    if (!me.is_commissioner) {
      return Response.json({ error: "Only the commissioner can change this" }, { status: 403 });
    }

    let draftAt: string | null = null;
    if (typeof body.draftAt === "string" && body.draftAt) {
      const when = new Date(body.draftAt);
      if (Number.isNaN(when.getTime())) {
        return Response.json({ error: "That is not a date" }, { status: 400 });
      }
      draftAt = when.toISOString();
    }

    const { error } = await db
      .from("leagues")
      .update({ draft_at: draftAt })
      .eq("id", me.league_id);

    if (error) return Response.json({ error: "Could not save the draft date" }, { status: 400 });
  }

  // The pick clock, and how many rounds get the full-screen reveal. Both have
  // been read by the draft room since it was built and set by nothing: they
  // were whatever the seed left behind.
  for (const [key, min, max] of [
    ["pickSeconds", 15, 600],
    ["cinematicRounds", 0, 40],
  ] as const) {
    if (body[key] == null) continue;

    if (!me.is_commissioner) {
      return Response.json({ error: "Only the commissioner can change this" }, { status: 403 });
    }

    const value = Number(body[key]);
    if (!Number.isInteger(value) || value < min || value > max) {
      return Response.json(
        { error: `${key} must be a whole number from ${min} to ${max}` },
        { status: 400 },
      );
    }

    const { data: league } = await db
      .from("leagues")
      .select("settings")
      .eq("id", me.league_id)
      .single();

    const { error } = await db
      .from("leagues")
      .update({ settings: { ...(league?.settings ?? {}), [key]: value } })
      .eq("id", me.league_id);

    if (error) return Response.json({ error: `Could not save ${key}` }, { status: 400 });
  }

  // The film that plays when the countdown runs out. Only its address is kept
  // here — the file itself is somewhere the browser can fetch it, which is
  // what stops the league's settings blob growing to the size of a video.
  if (body.introVideo !== undefined) {
    if (!me.is_commissioner) {
      return Response.json({ error: "Only the commissioner can change this" }, { status: 403 });
    }

    let introVideo: string | null = null;
    if (typeof body.introVideo === "string" && body.introVideo.trim()) {
      const checked = checkVideoSrc(body.introVideo);
      if ("error" in checked) return Response.json({ error: checked.error }, { status: 400 });
      introVideo = checked.src;
    }

    const { data: league } = await db
      .from("leagues")
      .select("settings")
      .eq("id", me.league_id)
      .single();

    const settings = { ...(league?.settings ?? {}) };
    if (introVideo) settings.introVideo = introVideo;
    else delete settings.introVideo;

    const { error } = await db.from("leagues").update({ settings }).eq("id", me.league_id);
    if (error) return Response.json({ error: "Could not save the intro video" }, { status: 400 });
  }

  // Rounds change the board's depth, so it is rebuilt afterwards too.
  if (body.rounds != null) {
    const rounds = Number(body.rounds);
    if (!Number.isInteger(rounds) || rounds < 1 || rounds > 40) {
      return Response.json({ error: "Rounds must be a whole number from 1 to 40" }, { status: 400 });
    }
    if (!me.is_commissioner) {
      return Response.json({ error: "Only the commissioner can change this" }, { status: 403 });
    }

    const { data: league } = await db
      .from("leagues")
      .select("settings")
      .eq("id", me.league_id)
      .single();

    const { error } = await db
      .from("leagues")
      .update({ settings: { ...(league?.settings ?? {}), rounds } })
      .eq("id", me.league_id);

    if (error) return Response.json({ error: "Could not save the rounds" }, { status: 400 });
  }

  if (body.teams != null) {
    const teams = Number(body.teams);
    if (!Number.isInteger(teams) || teams < 2 || teams > 16) {
      return Response.json({ error: "A league runs from 2 to 16 franchises" }, { status: 400 });
    }

    // set_team_count checks the commissioner itself, so the rule holds even if
    // this route is reached another way.
    const { error } = await db.rpc("set_team_count", {
      p_league_id: me.league_id,
      p_count: teams,
    });

    if (error) {
      return Response.json({ error: error.message }, { status: error.code === "42501" ? 403 : 409 });
    }
  } else if (body.rounds != null) {
    // Rounds alone still need the board regenerated to the new depth.
    const { error } = await db.rpc("commissioner_rebuild_board", { p_league_id: me.league_id });
    if (error) {
      return Response.json({ error: error.message }, { status: error.code === "42501" ? 403 : 409 });
    }
  }

  return Response.json({ ok: true });
}
