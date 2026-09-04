import { preseasonWeek } from "@/lib/preseason";
import type { ScoringFormat } from "@/lib/scoring";
import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A preseason week, scored, for the commissioner to check the arithmetic
 * against ESPN's own box scores.
 *
 * Read-only in the strongest sense: it writes nothing at all, not even the
 * schedule mirror. A preseason box score must never touch player_scores —
 * starters play one series and third-stringers play three quarters, so the
 * numbers are worthless as fantasy results while being exactly right as a
 * test of the parser. Keeping the two apart is why this is its own route
 * rather than a flag on the real one.
 *
 * Commissioner only. Not because the numbers are sensitive — they are public
 * box scores — but because a diagnostic page that eleven managers can find is
 * a page eleven managers will mistake for their scores.
 */
export async function GET(req: Request) {
  if (!isConfigured()) {
    return Response.json({ error: "The league database is not configured yet." }, { status: 503 });
  }

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  const { data: me } = await db
    .from("managers")
    .select("id, league_id, is_commissioner")
    .eq("auth_user_id", user.id)
    .single();

  if (!me) return Response.json({ error: "No manager for this account" }, { status: 403 });
  if (!me.is_commissioner) {
    return Response.json({ error: "Commissioner only" }, { status: 403 });
  }

  const weekParam = new URL(req.url).searchParams.get("week");
  const week = weekParam ? Number(weekParam) : null;
  if (weekParam && (!Number.isInteger(week) || week! < 1 || week! > 4)) {
    return Response.json({ error: "week must be 1, 2, 3 or 4" }, { status: 400 });
  }

  const { data: league } = await db
    .from("leagues")
    .select("settings")
    .eq("id", me.league_id)
    .single();

  // The league's own scoring format, so the page is testing the rules this
  // league will actually be run under rather than a default.
  const format = (league?.settings?.scoring ?? "ppr") as ScoringFormat;

  try {
    const result = await preseasonWeek(week, format, league?.settings ?? null);
    return Response.json(result);
  } catch (err) {
    console.error("[admin/preseason] ESPN unavailable", err);
    return Response.json(
      { error: "Could not reach ESPN just now. Nothing was changed." },
      { status: 502 },
    );
  }
}
