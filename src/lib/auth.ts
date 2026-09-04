import { createHmac, timingSafeEqual } from "node:crypto";

/** Failed attempts allowed in the window before a slot is locked out. */
export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;

function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is not set. Copy .env.example to .env.local.");
  return secret;
}

/**
 * The password of the Supabase auth user behind a manager.
 *
 * The PIN is the only credential a manager ever sees or types. Row-level
 * security is written against auth.uid(), though, so signing in has to produce
 * a real Supabase session — which needs a password. That password is derived
 * here from a server-held secret and never leaves the server, so it cannot be
 * guessed from the PIN and is useless to anyone who obtains it without the
 * secret.
 */
export function derivedPassword(managerId: string): string {
  return createHmac("sha256", authSecret()).update(`manager:${managerId}`).digest("hex");
}

/**
 * The synthetic address the auth user is keyed on. Managers sign in with a
 * franchise slot and a PIN; nobody collects their real email.
 *
 * The domain is deliberately still gridiron.invalid, and must stay that way.
 * It is not branding — it is the primary key of every existing auth user.
 * Signing in looks the address up, so changing a single character of it would
 * find nothing and lock all twelve managers out of the league permanently,
 * exactly as changing AUTH_SECRET would. A rename is not worth that, and this
 * string is never shown to anybody.
 */
export function slotEmail(leagueId: string, slot: string): string {
  return `${slot.toLowerCase()}.${leagueId}@gridiron.invalid`;
}

/** A PIN is exactly four digits. */
export function isValidPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4}$/.test(pin);
}

/** Constant-time compare, so a wrong PIN cannot be narrowed by timing. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
