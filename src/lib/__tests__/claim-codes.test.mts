/**
 * The front door: claim codes and where an attempt came from.
 *
 * A franchise opened up again — a cleared PIN, a manager let go — used to go
 * to whoever reached the sign-in page first. Now it carries a one-time code
 * only the commissioner is shown, bound to that franchise, and the claim needs
 * it. And a sign-in attempt is counted by where it came from as well as by the
 * franchise it names, so one source cannot spend five tries on every franchise
 * in turn.
 *
 * Both must also behave exactly as before on a database that has not run
 * migration 0064: no code means an open claim, no address column means the row
 * goes in without it, no count means nobody is locked out by it.
 */

process.env.AUTH_SECRET = "test-secret-for-claim-codes";

const {
  CLAIM_CODE_LENGTH,
  checkClaim,
  formatClaimCode,
  hashClaimCode,
  newClaimCode,
  normalizeClaimCode,
} = await import("../claim-codes.ts");
const { IP_MAX_FAILURES, clientIp, ipLockedOut, recordAttempt } = await import("../attempts.ts");
const { notMigratedYet } = await import("../db-errors.ts");

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!pass) failed++;
};
const ok = (label: string, got: boolean) => {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  if (!got) failed++;
};

console.log("--- a code ---");
{
  const codes = Array.from({ length: 200 }, () => newClaimCode());
  ok("eight characters", codes.every((c) => c.length === CLAIM_CODE_LENGTH));
  ok("none of them a character that reads as another (0 O 1 I L)", codes.every((c) => !/[01OIL]/.test(c)));
  ok("upper case letters and digits only", codes.every((c) => /^[A-Z2-9]+$/.test(c)));
  ok("and not the same twice in two hundred", new Set(codes).size === codes.length);

  eq("shown in two halves", formatClaimCode("K7QXM2PA"), "K7QX-M2PA");
  eq("typed any old way, it is the same code", normalizeClaimCode(" k7qx-m2pa "), "K7QXM2PA");
  eq("nothing typed is nothing", normalizeClaimCode(undefined), "");
}

console.log("\n--- bound to one franchise ---");
{
  const code = "K7QXM2PA";
  const a = hashClaimCode("franchise-a", code);
  ok("the stored form is not the code", !a.includes(code));
  eq("the same code for the same franchise hashes the same", hashClaimCode("franchise-a", "k7qx-m2pa"), a);
  ok("for another franchise it is another hash", hashClaimCode("franchise-b", code) !== a);
}

console.log("\n--- whether a claim may go ahead ---");
{
  const NOW = Date.parse("2026-10-01T12:00:00Z");
  const later = "2026-10-08T12:00:00Z";
  const earlier = "2026-09-30T12:00:00Z";
  const issued = { required: true as const, hash: hashClaimCode("franchise-a", "K7QXM2PA"), expiresAt: later };

  eq("no code outstanding is a claim as before", checkClaim({ required: false }, "franchise-a", undefined, NOW), "ok");
  eq("a code outstanding and none given", checkClaim(issued, "franchise-a", "", NOW), "missing");
  eq("the right code", checkClaim(issued, "franchise-a", "K7QX-M2PA", NOW), "ok");
  eq("the right code, typed casually", checkClaim(issued, "franchise-a", "k7qxm2pa", NOW), "ok");
  eq("the wrong code", checkClaim(issued, "franchise-a", "K7QX-M2PB", NOW), "wrong");
  eq("another franchise's code", checkClaim(issued, "franchise-b", "K7QX-M2PA", NOW), "wrong");
  eq("the right code, too late", checkClaim({ ...issued, expiresAt: earlier }, "franchise-a", "K7QX-M2PA", NOW), "expired");
  eq("an expiry nobody can read is not a pass", checkClaim({ ...issued, expiresAt: "soon" }, "franchise-a", "K7QX-M2PA", NOW), "expired");
}

console.log("\n--- where an attempt came from ---");
{
  const req = (headers: Record<string, string>) => new Request("https://pylonn.app/api/auth/signin", { headers });
  eq("the platform's own header first", clientIp(req({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.1" })), "203.0.113.7");
  eq("then the first of the forwarded chain", clientIp(req({ "x-forwarded-for": "198.51.100.1, 10.0.0.1" })), "198.51.100.1");
  eq("and nothing at all when neither is there", clientIp(req({})), null);
}

console.log("\n--- telling \"not migrated yet\" from a real failure ---");
{
  ok("a table the schema cache has not heard of", notMigratedYet({ code: "PGRST205" }));
  ok("a column it has not heard of", notMigratedYet({ code: "PGRST204" }));
  ok("a function it has not heard of", notMigratedYet({ code: "PGRST202" }));
  ok("Postgres's own word for a missing table", notMigratedYet({ code: "42P01" }));
  ok("but not a permissions failure", !notMigratedYet({ code: "42501" }));
  ok("nor no error at all", !notMigratedYet(null));
}

console.log("\n--- the address count, with and without 0064 ---");
{
  // Only the calls these helpers make are faked.
  const rpcAnswering = (answer: { data?: unknown; error?: unknown }) =>
    ({ rpc: async () => answer }) as unknown as Parameters<typeof ipLockedOut>[0];

  eq("under the limit is heard", await ipLockedOut(rpcAnswering({ data: IP_MAX_FAILURES - 1 }), "203.0.113.7"), false);
  eq("at the limit is not", await ipLockedOut(rpcAnswering({ data: IP_MAX_FAILURES }), "203.0.113.7"), true);
  eq("no address, no count", await ipLockedOut(rpcAnswering({ data: 999 }), null), false);
  eq("no count to read before 0064 locks nobody out",
    await ipLockedOut(rpcAnswering({ error: { code: "PGRST202", message: "not found" } }), "203.0.113.7"), false);

  const inserts: Record<string, unknown>[] = [];
  const answers = [{ code: "PGRST204", message: "Could not find the 'ip' column" }, null];
  const table = {
    from: () => ({
      insert: async (row: Record<string, unknown>) => {
        inserts.push(row);
        return { error: answers[inserts.length - 1] ?? null };
      },
    }),
  } as unknown as Parameters<typeof recordAttempt>[0];

  await recordAttempt(table, { leagueId: "L", slot: "AAA", succeeded: false, ip: "203.0.113.7" });
  eq("the attempt is written with its address", inserts[0]?.ip, "203.0.113.7");
  eq("and before 0064, written again without it", inserts.length, 2);
  ok("so the per-franchise count still sees it", inserts[1] != null && !("ip" in inserts[1]) && inserts[1].slot === "AAA");
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
