import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Moves a franchise to a division. Commissioner only, checked in SQL. */
export async function POST(req: Request) {
  if (!isConfigured()) {
    return Response.json({ error: "The league database is not configured yet." }, { status: 503 });
  }

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ error: "Not signed in" }, { status: 401 });

  let body: { managerId?: unknown; division?: unknown };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body must be JSON" }, { status: 400 });
  }

  const managerId = typeof body.managerId === "string" ? body.managerId : "";
  const division = typeof body.division === "string" ? body.division.trim().slice(0, 40) : "";
  if (!managerId || !division) {
    return Response.json({ error: "managerId and division are required" }, { status: 400 });
  }

  const { data, error } = await db.rpc("set_division", {
    p_manager_id: managerId,
    p_division: division,
  });

  if (error) {
    return Response.json({ error: error.message }, { status: error.code === "42501" ? 403 : 409 });
  }

  return Response.json(data);
}
