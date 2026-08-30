import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/**
 * Clears a manager's PIN. It does not set a new one — the manager chooses
 * theirs on next sign-in.
 *
 * This shape matters: if a commissioner could set another manager's PIN, they
 * could sign in as any team in the league. The commissioner check itself is in
 * clear_pin(), so it holds even if this route is reached another way.
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

  return Response.json(data);
}
