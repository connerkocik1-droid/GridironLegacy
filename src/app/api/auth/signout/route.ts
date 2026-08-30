import { isConfigured, serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!isConfigured()) return Response.json({ ok: true });
  const db = await serverClient();
  await db.auth.signOut();
  return Response.json({ ok: true });
}
