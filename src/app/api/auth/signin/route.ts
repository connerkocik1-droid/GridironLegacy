import bcrypt from "bcryptjs";
import { LOCKOUT_MINUTES, MAX_ATTEMPTS, derivedPassword, isValidPin, slotEmail } from "@/lib/auth";
import { isConfigured, serverClient, serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Signs in with a franchise slot and a four-digit PIN. */
export async function POST(req: Request) {
  if (!isConfigured()) {
    return Response.json({ error: "The league database is not configured yet." }, { status: 503 });
  }

  const leagueId = process.env.LEAGUE_ID;
  if (!leagueId) return Response.json({ error: "LEAGUE_ID is not set" }, { status: 500 });

  let body: { slot?: unknown; pin?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const slot = typeof body.slot === "string" ? body.slot.toUpperCase() : "";
  const pin = typeof body.pin === "string" ? body.pin : "";
  if (!slot || !pin) return Response.json({ error: "Franchise and PIN required" }, { status: 400 });

  const admin = serviceClient();

  // Rate limit before touching the hash, so a locked-out slot costs nothing.
  const { data: failures } = await admin.rpc("recent_pin_failures", {
    p_league_id: leagueId,
    p_slot: slot,
    p_window: `${LOCKOUT_MINUTES} minutes`,
  });

  if (Number(failures ?? 0) >= MAX_ATTEMPTS) {
    return Response.json(
      { error: `Too many attempts. Try again in ${LOCKOUT_MINUTES} minutes.` },
      { status: 429 },
    );
  }

  const record = async (succeeded: boolean) => {
    await admin.from("pin_attempts").insert({ league_id: leagueId, slot, succeeded });
  };

  const { data: manager } = await admin
    .from("managers")
    .select("id, slot, pin_hash, auth_user_id, franchise")
    .eq("league_id", leagueId)
    .eq("slot", slot)
    .single();

  // An unknown slot and a wrong PIN give the same answer, so the response
  // cannot be used to enumerate which franchises exist.
  const wrong = Response.json({ error: "That franchise and PIN do not match" }, { status: 401 });

  if (!manager) {
    await record(false);
    return wrong;
  }

  if (!manager.pin_hash) {
    return Response.json(
      { error: "This franchise has no PIN yet. Claim it to set one.", needsSetup: true },
      { status: 409 },
    );
  }

  if (!isValidPin(pin) || !(await bcrypt.compare(pin, manager.pin_hash))) {
    await record(false);
    return wrong;
  }

  const db = await serverClient();
  const { error } = await db.auth.signInWithPassword({
    email: slotEmail(leagueId, manager.slot),
    password: derivedPassword(manager.id),
  });

  if (error) {
    console.error("[auth/signin] session could not be created", error);
    await record(false);
    return Response.json({ error: "Could not sign you in" }, { status: 500 });
  }

  await record(true);
  return Response.json({ ok: true, slot: manager.slot, franchise: manager.franchise });
}
