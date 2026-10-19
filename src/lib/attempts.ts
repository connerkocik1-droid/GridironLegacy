import { notMigratedYet } from "./db-errors";
import type { serviceClient } from "./supabase";

type Admin = ReturnType<typeof serviceClient>;

/**
 * Sign-in attempts, counted by where they came from as well as by franchise.
 *
 * The per-franchise count (recent_pin_failures) stops somebody walking one
 * franchise's PINs. It did nothing about one source spending its five tries on
 * each franchise in turn — twelve franchises, sixty guesses a quarter of an
 * hour. This adds the second count: too many failures from one address,
 * whichever franchise they named, and that address waits.
 */

/** Failures one address may make across every franchise within the window. */
export const IP_MAX_FAILURES = 20;
export const IP_WINDOW_MINUTES = 15;

/**
 * The address a request came from, as the platform reports it.
 *
 * On Vercel both headers are set by the platform itself rather than passed
 * through from the client. Null when neither is present — a local run — in
 * which case the per-address count simply does not apply.
 */
export function clientIp(req: Request): string | null {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || null;
}

/** Whether this address has failed too often lately to be heard again yet. */
export async function ipLockedOut(admin: Admin, ip: string | null): Promise<boolean> {
  if (!ip) return false;
  const { data, error } = await admin.rpc("recent_ip_failures", {
    p_ip: ip,
    p_window: `${IP_WINDOW_MINUTES} minutes`,
  });
  if (error) {
    // Before migration 0064 there is no count to read, which is how it was.
    if (!notMigratedYet(error)) console.error("[attempts] could not read the address count", error);
    return false;
  }
  return Number(data ?? 0) >= IP_MAX_FAILURES;
}

/**
 * Writes an attempt down, with the address it came from.
 *
 * Before migration 0064 the table has no address column and would refuse the
 * whole row, which would quietly switch the per-franchise lockout off too — so
 * the row goes in without it.
 */
export async function recordAttempt(
  admin: Admin,
  attempt: { leagueId: string; slot: string; succeeded: boolean; ip: string | null },
): Promise<void> {
  const row = { league_id: attempt.leagueId, slot: attempt.slot, succeeded: attempt.succeeded };
  let { error } = await admin.from("pin_attempts").insert({ ...row, ip: attempt.ip });
  if (error && notMigratedYet(error)) ({ error } = await admin.from("pin_attempts").insert(row));
  if (error) console.error("[attempts] could not record the attempt", error);
}
