import { createHmac, randomInt } from "node:crypto";
import { safeEqual } from "./auth";
import { notMigratedYet } from "./db-errors";
import type { serviceClient } from "./supabase";

type Admin = ReturnType<typeof serviceClient>;

/**
 * One-time codes for claiming a franchise that has been opened up again.
 *
 * Claiming used to need nothing but the franchise's name. When the
 * commissioner cleared a PIN or let a manager go, the franchise — roster,
 * record and picks — went to whoever reached the sign-in page first. Now those
 * two actions issue a code, which only the commissioner sees, and the claim
 * needs it. A franchise with no code outstanding is claimed as it always was,
 * which is what the night a league is set up needs.
 *
 * Only a keyed hash is stored, bound to the franchise it was issued for: a
 * code for one team is not a code for another, and the table is no use to
 * anybody who reads it without the server's secret.
 */

/** No 0/O, no 1/I/L: a code is read off one screen and typed on another. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const CLAIM_CODE_LENGTH = 8;
export const CLAIM_CODE_DAYS = 7;

/** A fresh code, eight characters from the alphabet above. */
export function newClaimCode(): string {
  let code = "";
  for (let i = 0; i < CLAIM_CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return code;
}

/** "K7QXM2PA" as "K7QX-M2PA", which is easier to read aloud and to copy. */
export function formatClaimCode(code: string): string {
  const c = normalizeClaimCode(code);
  return c.length > 4 ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** What somebody typed, as the code it is meant to be: case and dashes ignored. */
export function normalizeClaimCode(input: unknown): string {
  return typeof input === "string" ? input.toUpperCase().replace(/[^A-Z0-9]/g, "") : "";
}

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error("AUTH_SECRET is not set. Copy .env.example to .env.local.");
  return s;
}

/** The stored form: HMAC-SHA256 under AUTH_SECRET, bound to the franchise. */
export function hashClaimCode(managerId: string, code: string): string {
  return createHmac("sha256", secret())
    .update(`claim:${managerId}:${normalizeClaimCode(code)}`)
    .digest("hex");
}

export type Claim =
  | { required: false }
  | { required: true; hash: string; expiresAt: string };

export type ClaimVerdict = "ok" | "missing" | "expired" | "wrong";

/**
 * Whether this claim may go ahead.
 *
 * Pure, so the rule is testable without a database: no code outstanding is a
 * claim as before; otherwise a code must be given, must not have expired, and
 * must be the one issued for this franchise.
 */
export function checkClaim(
  claim: Claim,
  managerId: string,
  input: unknown,
  now: number = Date.now(),
): ClaimVerdict {
  if (!claim.required) return "ok";
  const code = normalizeClaimCode(input);
  if (!code) return "missing";
  const expires = Date.parse(claim.expiresAt);
  if (!Number.isFinite(expires) || expires <= now) return "expired";
  return safeEqual(hashClaimCode(managerId, code), claim.hash) ? "ok" : "wrong";
}

/**
 * Issues a code for a franchise, replacing any it already had.
 *
 * Returns the code to show the commissioner — the only time it exists in the
 * clear — or null on a database that has not run migration 0064, where the
 * claim stays open exactly as it always was.
 */
export async function issueClaimCode(
  admin: Admin,
  opts: { leagueId: string; managerId: string; issuedBy: string | null },
): Promise<{ code: string; expiresAt: string } | null> {
  const code = newClaimCode();
  const expiresAt = new Date(Date.now() + CLAIM_CODE_DAYS * 86_400_000).toISOString();

  const { error } = await admin.from("franchise_claims").upsert({
    manager_id: opts.managerId,
    league_id: opts.leagueId,
    code_hash: hashClaimCode(opts.managerId, code),
    expires_at: expiresAt,
    issued_by: opts.issuedBy,
    issued_at: new Date().toISOString(),
  });

  if (error) {
    if (!notMigratedYet(error)) console.error("[claim-codes] could not issue a code", error);
    return null;
  }
  return { code: formatClaimCode(code), expiresAt };
}

/** The code outstanding for a franchise, if there is one. */
export async function readClaim(admin: Admin, managerId: string): Promise<Claim> {
  const { data, error } = await admin
    .from("franchise_claims")
    .select("code_hash, expires_at")
    .eq("manager_id", managerId)
    .maybeSingle();

  if (error) {
    // Not migrated yet: nothing can have been issued, so nothing is required.
    if (notMigratedYet(error)) return { required: false };
    throw error;
  }
  return data
    ? { required: true, hash: data.code_hash as string, expiresAt: data.expires_at as string }
    : { required: false };
}

/** Which franchises in a league have a code outstanding, for the sign-in page. */
export async function franchisesNeedingCodes(admin: Admin, leagueId: string): Promise<Set<string>> {
  const { data, error } = await admin
    .from("franchise_claims")
    .select("manager_id")
    .eq("league_id", leagueId);

  if (error) {
    if (!notMigratedYet(error)) console.error("[claim-codes] could not read the codes", error);
    return new Set();
  }
  return new Set((data ?? []).map((r) => r.manager_id as string));
}

/** A code is good for one claim. */
export async function consumeClaim(admin: Admin, managerId: string): Promise<void> {
  const { error } = await admin.from("franchise_claims").delete().eq("manager_id", managerId);
  if (error && !notMigratedYet(error)) console.error("[claim-codes] could not retire a used code", error);
}
