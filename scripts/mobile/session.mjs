/**
 * The cookie @supabase/ssr reads a session out of.
 *
 * The audit needs the pages to render their signed-in layout, and being signed
 * in starts with a cookie the server can find. The name is not arbitrary:
 * @supabase/ssr derives it from the host in NEXT_PUBLIC_SUPABASE_URL, and the
 * audit points that at 127.0.0.1 — hence "sb-127-auth-token". Change the host
 * the audit runs against and this name has to change with it.
 *
 * The token itself is nonsense, which is fine: scripts/mobile/stub.mjs is what
 * validates it, and it says yes to anything.
 */
export function sessionCookie() {
  const session = {
    access_token: "stub-access-token",
    refresh_token: "stub-refresh-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "auth-user-0", email: "t01@gridiron.local" },
  };
  return {
    name: "sb-127-auth-token",
    value: `base64-${Buffer.from(JSON.stringify(session)).toString("base64")}`,
    domain: "localhost",
    path: "/",
  };
}
