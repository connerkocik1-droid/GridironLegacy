import { isConfigured, serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * The franchises in this league and whether each is claimed. Public, because
 * it is what the sign-up page shows before anyone is signed in — it exposes
 * only franchise names, never PINs or emails.
 */
export async function GET() {
  // Which of them are missing, by name. Every name here is already in
  // .env.example in the open, and no value is ever named — but knowing that
  // it is LEAGUE_ID rather than the anon key turns "not configured yet" from
  // a dead end into an instruction. This is the first page anybody sees on a
  // fresh deployment, and on Vercel a variable added for Production is NOT
  // present in Preview, so the two environments fail here independently.
  const missing = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_KEY",
    "LEAGUE_ID",
    "AUTH_SECRET",
  ].filter((name) => !process.env[name]);

  if (!isConfigured() || missing.length > 0) {
    return Response.json(
      {
        error: `This deployment is missing ${missing.join(", ")}. Set ${
          missing.length === 1 ? "it" : "them"
        } in the hosting environment — on Vercel, for the Preview environment as well as Production — and redeploy.`,
        missing,
      },
      { status: 503 },
    );
  }

  const leagueId = process.env.LEAGUE_ID as string;

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
