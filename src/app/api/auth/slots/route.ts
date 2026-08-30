import { isConfigured, serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * The franchises in this league and whether each is claimed. Public, because
 * it is what the sign-up page shows before anyone is signed in — it exposes
 * only franchise names, never PINs or emails.
 */
export async function GET() {
  if (!isConfigured()) {
    return Response.json({ error: "The league database is not configured yet." }, { status: 503 });
  }

  const leagueId = process.env.LEAGUE_ID;
  if (!leagueId) return Response.json({ error: "LEAGUE_ID is not set" }, { status: 500 });

  const db = serviceClient();
  const { data, error } = await db
    .from("managers")
    .select("id, slot, name, franchise, pin_hash, is_commissioner")
    .eq("league_id", leagueId)
    .order("slot");

  if (error) {
    console.error("[auth/slots] read failed", error);
    return Response.json({ error: "Could not read the league" }, { status: 500 });
  }

  return Response.json({
    leagueId,
    slots: (data ?? []).map((m) => ({
      id: m.id,
      slot: m.slot,
      name: m.name,
      franchise: m.franchise,
      // Never send the hash itself, only whether one exists.
      claimed: m.pin_hash != null,
      isCommissioner: m.is_commissioner,
    })),
  });
}
