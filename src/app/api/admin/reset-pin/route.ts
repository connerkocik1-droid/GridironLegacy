import { isConfigured, serverClient, serviceClient } from "@/lib/supabase";
import { issueClaimCode } from "@/lib/claim-codes";

export const dynamic = "force-dynamic";

/**
 * Clears a manager's PIN. It does not set a new one — the manager chooses
 * theirs on next sign-in.
 *
 * This shape matters: if a commissioner could set another manager's PIN, they
 * could sign in as any team in the league. The commissioner check itself is in
 * clear_pin(), so it holds even if this route is reached another way.
 *
 * Clearing a PIN opens the franchise to be claimed again, and it used to be
 * open to anybody who reached the sign-in page first. So it now comes back
 * with a one-time claim code, shown to the commissioner here and nowhere else,
 * for them to hand to the manager. On a database without migration 0064 there
 * is nowhere to keep a code, and the claim stays open as it always was.
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

  let body: { managerId?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const managerId = typeof body.managerId === "string" ? body.managerId : "";
  if (!managerId) return Response.json({ error: "managerId is required" }, { status: 400 });

  const { data, error } = await db.rpc("clear_pin", { p_manager_id: managerId });

  if (error) {
    const denied = error.code === "42501";
    return Response.json({ error: error.message }, { status: denied ? 403 : 400 });
  }

  // clear_pin has already established that this is the commissioner and that
  // the franchise is in their league; these two only label the code.
  const { data: me } = await db
    .from("managers")
    .select("id, league_id")
    .eq("auth_user_id", user.id)
    .maybeSingle();

  const issued = me
    ? await issueClaimCode(serviceClient(), {
        leagueId: me.league_id,
        managerId,
        issuedBy: me.id,
      })
    : null;

  return Response.json({
    ...(data as object),
    claimCode: issued?.code ?? null,
    claimCodeExpiresAt: issued?.expiresAt ?? null,
  });
}
