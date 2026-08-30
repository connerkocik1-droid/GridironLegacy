import bcrypt from "bcryptjs";
import { isValidPin } from "@/lib/auth";
import { isConfigured, serverClient, serviceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Changes the signed-in manager's PIN.
 *
 * The current PIN is required even though the session already proves who they
 * are: a browser left open on somebody's desk should not be enough to lock its
 * owner out of their own franchise.
 *
 * The new hash is written with the service key because 0010 took pin_hash away
 * from browser sessions — that revoke is what stops a manager setting their
 * own hash directly, and it applies here too. What makes this safe is that the
 * old PIN was checked first.
 *
 * The Supabase password behind the session is derived from the manager's id
 * and a server-held secret, not from the PIN, so it does not change and the
 * session survives.
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

  let body: { current?: unknown; next?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  if (!isValidPin(body.next)) {
    return Response.json({ error: "Your new PIN must be exactly four digits" }, { status: 400 });
  }

  const admin = serviceClient();

  const { data: manager } = await admin
    .from("managers")
    .select("id, pin_hash")
    .eq("auth_user_id", user.id)
    .single();

  if (!manager) return Response.json({ error: "No manager for this account" }, { status: 403 });

  // A franchise whose PIN the commissioner cleared has no current PIN to give.
  if (!manager.pin_hash) {
    return Response.json(
      { error: "This franchise has no PIN yet. Sign out and claim it to set one." },
      { status: 409 },
    );
  }

  const current = typeof body.current === "string" ? body.current : "";
  if (!isValidPin(current) || !(await bcrypt.compare(current, manager.pin_hash))) {
    return Response.json({ error: "That is not your current PIN" }, { status: 401 });
  }

  if (current === body.next) {
    return Response.json({ error: "That is already your PIN" }, { status: 400 });
  }

  const { error } = await admin
    .from("managers")
    .update({ pin_hash: await bcrypt.hash(body.next, 10) })
    .eq("id", manager.id);

  if (error) {
    console.error("[auth/pin] could not save the new PIN", error);
    return Response.json({ error: "Could not change your PIN" }, { status: 500 });
  }

  return Response.json({ ok: true });
}
