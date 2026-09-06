import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Settles a franchise's dues, or the whole league's at once.
 *
 * Commissioner only, checked in SQL rather than here — a rule about money
 * should be true of the database and not merely of the app in front of it.
 *
 * A null managerId means everybody, which is the button the office actually
 * needs: "they are all paid up, clear it" is one press rather than twelve.
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

  let body: { managerId?: unknown; paid?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  if (typeof body.paid !== "boolean") {
    return Response.json({ error: "paid must be true or false" }, { status: 400 });
  }

  // Undefined and null both mean the whole league. An empty string does not:
  // that is a missing id, and settling twelve people's dues is not something
  // to do because a value came through blank.
  const managerId =
    body.managerId === undefined || body.managerId === null
      ? null
      : typeof body.managerId === "string" && body.managerId
        ? body.managerId
        : "";
  if (managerId === "") {
    return Response.json({ error: "managerId must be an id, or absent" }, { status: 400 });
  }

  const { data, error } = await db.rpc("set_dues_paid", {
    p_manager_id: managerId,
    p_paid: body.paid,
  });

  if (error) {
    return Response.json({ error: error.message }, { status: error.code === "42501" ? 403 : 409 });
  }

  return Response.json(data);
}
