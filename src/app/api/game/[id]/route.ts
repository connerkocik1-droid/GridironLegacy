import { fetchGameDetail, fetchPlayByPlay, fetchScoreboard, type Game, type Play } from "@/lib/espn";
import { gamecast, type Ownership } from "@/lib/gamecast";
import { isConfigured, serverClient } from "@/lib/supabase";
import type { ScoringFormat } from "@/lib/scoring";

export const dynamic = "force-dynamic";

/**
 * One real football game, with this league's rosters laid over it.
 *
 * ESPN is asked for three things — the slate, so the header knows who is
 * playing and what the score is; the box score; and the play-by-play — and
 * twelve managers watching the same game must not become thirty-six requests
 * every twenty seconds. So each of the three is memoised for a few seconds
 * below, keyed by what was asked for.
 *
 * The response carries every rostered player in the game and the franchise
 * holding him, and never says which of them belongs to whoever is asking.
 * That is deliberate: it makes one answer right for the whole league, and the
 * browser marks its own from the manager it already knows about. Rosters are
 * not a secret here — the league page lists every one of them.
 */

/** Long enough to collapse a wave of pollers, short enough to still be live. */
const TTL_MS = 12_000;

const cache = new Map<string, { at: number; value: Promise<unknown> }>();

function memo<T>(key: string, make: () => Promise<T>): Promise<T> {
  const held = cache.get(key);
  if (held && Date.now() - held.at < TTL_MS) return held.value as Promise<T>;

  const value = make().catch((err) => {
    // A failure must not be remembered for twelve seconds, or one blip
    // becomes twelve seconds of blank screens for everybody.
    cache.delete(key);
    throw err;
  });

  cache.set(key, { at: Date.now(), value });

  // Unbounded growth would be a leak in a long-lived server. Sixteen games in
  // a slate, three keys each, and anything older than the window is dead.
  if (cache.size > 64) {
    for (const [k, v] of cache) if (Date.now() - v.at > TTL_MS) cache.delete(k);
  }

  return value;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!isConfigured()) {
    return Response.json({ error: "The league database is not configured yet." }, { status: 503 });
  }

  const { id } = await ctx.params;
  if (!/^\d+$/.test(id)) {
    return Response.json({ error: "That is not a game id." }, { status: 400 });
  }

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

  const { data: league } = await db
    .from("leagues")
    .select("settings")
    .eq("id", me.league_id)
    .single();
  const format = (league?.settings?.scoring ?? "ppr") as ScoringFormat;

  // Who holds whom. One query rather than one per player, and it is the
  // roster as it stands rather than the draft pool — a waiver pickup is in
  // this game too.
  const { data: slots } = await db
    .from("roster_slots")
    .select("player_name, manager_id")
    .eq("league_id", me.league_id);

  const { data: managers } = await db
    .from("managers")
    .select("id, franchise")
    .eq("league_id", me.league_id);

  const franchiseOf = new Map((managers ?? []).map((m) => [m.id as string, m.franchise as string]));
  const owners: Ownership = { byPlayer: new Map() };
  for (const slot of slots ?? []) {
    const franchise = franchiseOf.get(slot.manager_id as string);
    if (franchise) {
      owners.byPlayer.set(slot.player_name as string, {
        franchise,
        managerId: slot.manager_id as string,
      });
    }
  }

  try {
    // In parallel: none of the three depends on another, and a gamecast that
    // waits for the play feed before showing the score is a gamecast nobody
    // opens twice.
    const [slate, detail, plays] = await Promise.all([
      memo("slate", () => fetchScoreboard()),
      memo(`detail:${id}`, () => fetchGameDetail(id)),
      // The play feed is the expensive one — up to six pages — and the least
      // urgent. A failure costs the drive log and nothing else.
      memo(`plays:${id}`, () => fetchPlayByPlay(id)).catch((): Play[] => []),
    ]);

    const game = (slate as Game[]).find((g) => g.id === id) ?? null;
    const shaped = gamecast(detail.stats, detail.plays, plays, owners, format);

    return Response.json({
      game,
      ...shaped,
      teamTotals: detail.teamTotals,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    // ESPN is undocumented and unreliable. A gamecast that cannot be built is
    // an empty gamecast with a sentence, not a five hundred.
    console.error(`[game] ESPN unavailable for ${id}`, err);
    return Response.json(
      {
        game: null,
        owned: [],
        notable: [],
        scoring: [],
        plays: [],
        teamTotals: {},
        error: "Live coverage is unavailable right now.",
        fetchedAt: null,
      },
      { status: 200 },
    );
  }
}
