import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** Who is signed in, if anyone. Used by the header and route guards. */
export async function GET() {
  if (!isConfigured()) return Response.json({ manager: null, configured: false });

  const db = await serverClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user) return Response.json({ manager: null, configured: true });

  const { data: manager } = await db
    .from("managers")
    .select("id, slot, name, franchise, is_commissioner, ready")
    .eq("auth_user_id", user.id)
    .single();

  return Response.json({ manager: manager ?? null, configured: true });
}
