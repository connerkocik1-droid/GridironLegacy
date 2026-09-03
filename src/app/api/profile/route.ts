import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * A manager's own profile: the franchise name, and where to email them.
 *
 * The write goes through the manager's own session, not the service key, so
 * the column grants decide what may change — `franchise` from 0010, `email`
 * and `email_notices` from 0034 — and the request cannot reach `pin_hash`,
 * `auth_user_id` or `is_commissioner` however it is shaped.
 *
 * Each field is optional and written only when sent, so the email form does
 * not have to know the team name and the name form does not have to know the
 * address.
 */
export async function PATCH(req: Request) {
  if (!isConfigured()) {
    return Response.json({ error: "The league database is not configured yet." }, { status: 503 });
  }

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body: { franchise?: unknown; email?: unknown; emailNotices?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const changes: { franchise?: string; email?: string | null; email_notices?: boolean } = {};

  if (body.franchise !== undefined) {
    const franchise = typeof body.franchise === "string" ? body.franchise.trim() : "";
    if (!franchise) return Response.json({ error: "Give your team a name" }, { status: 400 });
    if (franchise.length > 40) {
      return Response.json({ error: "That name is too long — 40 characters at most" }, { status: 400 });
    }
    changes.franchise = franchise;
  }

  if (body.email !== undefined) {
    const email = typeof body.email === "string" ? body.email.trim() : "";

    // An empty string is how a manager takes their address off, which is a
    // different thing from never having given one and has to be allowed.
    if (!email) changes.email = null;
    else {
      // Deliberately loose. The only test that means anything is whether mail
      // arrives, and a strict pattern here mostly rejects addresses that work.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) {
        return Response.json({ error: "That does not look like an email address" }, { status: 400 });
      }
      changes.email = email;
    }
  }

  if (body.emailNotices !== undefined) {
    if (typeof body.emailNotices !== "boolean") {
      return Response.json({ error: "emailNotices must be true or false" }, { status: 400 });
    }
    changes.email_notices = body.emailNotices;
  }

  if (!Object.keys(changes).length) {
    return Response.json({ error: "Nothing to change" }, { status: 400 });
  }

  const { data, error } = await db
    .from("managers")
    .update(changes)
    .eq("auth_user_id", user.id)
    .select("id, slot, franchise, email, email_notices")
    .single();

  if (error) {
    return Response.json({ error: "Could not save that" }, { status: 409 });
  }

  return Response.json({
    ok: true,
    franchise: data.franchise,
    email: data.email,
    emailNotices: data.email_notices,
  });
}
