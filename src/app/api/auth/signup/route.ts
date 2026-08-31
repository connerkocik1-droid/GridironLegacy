import bcrypt from "bcryptjs";
import { derivedPassword, isValidPin, slotEmail } from "@/lib/auth";
import { isConfigured, serverClient, serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * The auth account already using an address, if there is one.
 *
 * There is no lookup by address in the admin API, so this reads the pages. A
 * league is twelve people and the first page covers it many times over; the
 * loop is there so a bigger project does not quietly return nothing.
 */
async function findByEmail(
  admin: ReturnType<typeof serviceClient>,
  email: string,
): Promise<string | null> {
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error || !data.users.length) return null;

    const found = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (found) return found.id;
    if (data.users.length < 200) return null;
  }
  return null;
}

/**
 * Claims a franchise and sets its PIN.
 *
 * Also the path a manager takes after the commissioner clears their PIN: the
 * slot exists but has no hash, so it is claimable again by whoever holds it.
 */
export async function POST(req: Request) {
  if (!isConfigured()) {
    return Response.json({ error: "The league database is not configured yet." }, { status: 503 });
  }

  const leagueId = process.env.LEAGUE_ID;
  if (!leagueId) return Response.json({ error: "LEAGUE_ID is not set" }, { status: 500 });

  let body: { slot?: unknown; pin?: unknown; name?: unknown; franchise?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const slot = typeof body.slot === "string" ? body.slot.toUpperCase() : "";
  if (!slot) return Response.json({ error: "Pick a franchise" }, { status: 400 });

  // A first name is required, not optional as it was. It is what the franchise
  // is named after, and it is how eleven other people know whose team they are
  // looking at on the board.
  const firstName = typeof body.name === "string" ? body.name.trim().slice(0, 40) : "";
  if (!firstName) {
    return Response.json({ error: "Your first name is required" }, { status: 400 });
  }

  if (!isValidPin(body.pin)) {
    return Response.json({ error: "Your PIN must be exactly four digits" }, { status: 400 });
  }

  const admin = serviceClient();

  const { data: manager } = await admin
    .from("managers")
    .select("id, slot, pin_hash, auth_user_id, franchise, name")
    .eq("league_id", leagueId)
    .eq("slot", slot)
    .single();

  if (!manager) return Response.json({ error: "No such franchise" }, { status: 404 });

  // A claimed slot cannot be taken over. Only the commissioner clearing the
  // PIN reopens it, and they never get to set one.
  if (manager.pin_hash) {
    return Response.json(
      { error: "That franchise is already claimed. Sign in instead." },
      { status: 409 },
    );
  }

  const pinHash = await bcrypt.hash(body.pin, 10);
  const email = slotEmail(leagueId, slot);
  const password = derivedPassword(manager.id);

  // The auth user survives a PIN reset, so it is created once and reused.
  let authUserId = manager.auth_user_id;

  if (authUserId) {
    const { error } = await admin.auth.admin.updateUserById(authUserId, { password });
    if (error) {
      console.error("[auth/signup] could not refresh auth user", error);
      return Response.json({ error: "Could not claim that franchise" }, { status: 500 });
    }
  } else {
    const { data: created, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { slot, league_id: leagueId },
    });

    if (created?.user) {
      authUserId = created.user.id;
    } else {
      // The address is derived from the franchise slot, so it is the same one
      // every time this franchise is claimed. A manager who was let go leaves
      // an account under it, and if deleting that account did not go through
      // it is standing in the doorway. Adopt it rather than turning the
      // replacement away from a franchise that is genuinely free.
      const existing = await findByEmail(admin, email);

      if (!existing) {
        console.error("[auth/signup] could not create auth user", error);
        return Response.json({ error: "Could not claim that franchise" }, { status: 500 });
      }

      const { error: reset } = await admin.auth.admin.updateUserById(existing, { password });
      if (reset) {
        console.error("[auth/signup] could not take over the old account", reset);
        return Response.json({ error: "Could not claim that franchise" }, { status: 500 });
      }
      authUserId = existing;
    }
  }

  // The franchise takes the new manager's name unless it already has one
  // somebody chose. "Open Team" and "Dana's Team" are names this app made up;
  // "Steel Cartel" is not, and a franchise called that keeps it through a
  // change of manager.
  const { data: named } = await admin.rpc("is_default_franchise_name", {
    p_name: manager.franchise,
  });

  const franchise =
    typeof body.franchise === "string" && body.franchise.trim()
      ? body.franchise.trim().slice(0, 60)
      : named === false
        ? manager.franchise
        : `${firstName}'s Team`;

  const { error: updateError } = await admin
    .from("managers")
    .update({ pin_hash: pinHash, auth_user_id: authUserId, franchise, name: firstName })
    .eq("id", manager.id);

  if (updateError) {
    console.error("[auth/signup] could not save the manager", updateError);
    return Response.json({ error: "Could not claim that franchise" }, { status: 500 });
  }

  // Sign them straight in, so claiming a franchise lands them in the league.
  const db = await serverClient();
  const { error: signInError } = await db.auth.signInWithPassword({ email, password });
  if (signInError) {
    return Response.json({ ok: true, signedIn: false, franchise });
  }

  return Response.json({ ok: true, signedIn: true, slot, franchise });
}
