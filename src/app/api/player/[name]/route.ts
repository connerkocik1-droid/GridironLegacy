import { profileFor, resolvePlayerName } from "@/lib/player-profile";
import { formatStatLine, sumStatLines, type StatLine } from "@/lib/scoring";
import { fetchNews } from "@/lib/news";
import { normalizeName } from "@/lib/player-names";
import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * One player, from every source the app has.
 *
 * Who he is comes from the draft pool and the historical seasons, both local.
 * What he has done this season comes from the league's own scores. What is
 * being said about him comes from the wire. Fitness is the one thing fetched
 * separately, by the page, because it is shared across every player on screen.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name: raw } = await ctx.params;
  const asked = decodeURIComponent(raw);
  const name = resolvePlayerName(asked);
  const profile = profileFor(name);

  // The wire, narrowed to him. Failing to reach it costs the news and nothing
  // else — the rest of the page is local.
  const news = await fetchNews()
    .then((stories) =>
      stories.filter((s) => s.players.some((p) => normalizeName(p) === normalizeName(name))),
    )
    .catch(() => []);

  if (!isConfigured()) {
    return Response.json({ profile, news, season: null, owner: null });
  }

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();

  if (!user) return Response.json({ profile, news, season: null, owner: null });

  const { data: me } = await db
    .from("managers")
    .select("id, league_id")
    .eq("auth_user_id", user.id)
    .single();

  if (!me) return Response.json({ profile, news, season: null, owner: null });

  const [{ data: scores }, { data: held }, { data: league }] = await Promise.all([
    db
      .from("player_scores")
      .select("week, points, stat_line, stats")
      .eq("league_id", me.league_id)
      .eq("player_name", profile.name)
      .order("week"),
    db
      .from("roster_slots")
      .select("manager_id, lineup_slot")
      .eq("league_id", me.league_id)
      .eq("player_name", profile.name)
      .maybeSingle(),
    db.from("leagues").select("season").eq("id", me.league_id).single(),
  ]);

  let owner = null;
  if (held) {
    const { data: manager } = await db
      .from("managers")
      .select("id, slot, franchise")
      .eq("id", held.manager_id)
      .single();
    owner = manager
      ? { ...manager, slot: manager.slot, mine: manager.id === me.id, lineupSlot: held.lineup_slot }
      : null;
  }

  const weeks = (scores ?? []).map((r) => ({
    week: r.week as number,
    points: Number(r.points),
    statLine: (r.stat_line as string | null) ?? "",
    stats: (r.stats ?? null) as StatLine | null,
  }));

  // The season as one line, which is what the profile leads with. Summed here
  // rather than in the page because this is where the position is known, and
  // the position decides the wording.
  const seasonLine = formatStatLine(
    sumStatLines(weeks.map((w) => w.stats).filter((s): s is StatLine => Boolean(s))),
    profile.position,
  );

  return Response.json({
    profile,
    news,
    season: {
      year: league?.season ?? null,
      weeks,
      statLine: seasonLine,
      total: Math.round(weeks.reduce((sum, w) => sum + w.points, 0) * 10) / 10,
      best: weeks.reduce((best, w) => (w.points > best ? w.points : best), 0),
    },
    owner,
  });
}
