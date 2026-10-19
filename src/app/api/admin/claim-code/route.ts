import { issueClaimCode } from "@/lib/claim-codes";
import { isConfigured, serverClient, serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Issues a fresh claim code for an open franchise.
 *
 * Clearing a PIN and letting a manager go already issue one. This is for the
 * rest: a code that ran out before it was used, one that was lost, or a
 * franchise that has never been claimed and should not go to whoever finds
 * the sign-in page first. Issuing replaces any code the franchise had.
 *
 * Commissioner only, for a franchise in their own league that nobody holds.
 */
export async function POST(req: Request) {
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
    return Response.json({ error: "Only the commissioner can issue a claim code" }, { status: 403 });
  }

  let body: { managerId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const managerId = typeof body.managerId === "string" ? body.managerId : "";
  if (!managerId) return Response.json({ error: "managerId is required" }, { status: 400 });

  // Read with the service key, because whether a PIN is set is the whole
  // question and the browser's session is not shown the hash.
  const admin = serviceClient();
  const { data: target } = await admin
    .from("managers")
    .select("id, league_id, franchise, pin_hash")
    .eq("id", managerId)
    .maybeSingle();

  if (!target || target.league_id !== me.league_id) {
    return Response.json({ error: "No such franchise in your league" }, { status: 404 });
  }
  if (target.pin_hash) {
    return Response.json(
      { error: `${target.franchise} is claimed. Clear its PIN first if it needs claiming again.` },
      { status: 409 },
    );
  }

  const issued = await issueClaimCode(admin, {
    leagueId: me.league_id,
    managerId,
    issuedBy: me.id,
  });

  if (!issued) {
    return Response.json(
      { error: "Claim codes need the latest database update. Run supabase/all-migrations.sql, then try again." },
      { status: 503 },
    );
  }

  return Response.json({
    ok: true,
    franchise: target.franchise,
    claimCode: issued.code,
    claimCodeExpiresAt: issued.expiresAt,
  });
}
