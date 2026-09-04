/**
 * The two strings a rename must not touch.
 *
 * Managers do not have accounts in any ordinary sense: they sign in with a
 * franchise slot and a four-digit PIN, and underneath that the app keys them
 * on a synthetic address it makes up. Signing in looks that address up in
 * auth.users. So the address is a primary key that happens to be spelled like
 * a brand — and rebranding it would find nothing, for every manager, for good.
 *
 * The same is true of the derived password: it is an HMAC over AUTH_SECRET, so
 * changing that secret has the identical effect. Both failures are silent,
 * total, and only discoverable by twelve people at once on a Sunday.
 *
 * These checks exist so that the next person to run a find-and-replace across
 * the repo — which is exactly how the app was renamed to Pylon Fantasy — gets
 * a failing test rather than a locked-out league.
 */

import { isValidPin, safeEqual, slotEmail } from "../auth";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}`}`);
  if (!pass) failed++;
};
const ok = (label: string, got: boolean) => {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  if (!got) failed++;
};

console.log("--- the address a manager is keyed on ---");

const LEAGUE = "3f8a1c22-0000-4000-8000-000000000001";

eq(
  "is the slot, the league, and a domain that must not be rebranded",
  slotEmail(LEAGUE, "HELX"),
  `helx.${LEAGUE}@gridiron.invalid`,
);

// Said twice on purpose. The line above would still pass if somebody changed
// both the code and the expectation together in one sweep; this one names the
// consequence, so it has to be read before it can be edited away.
ok(
  "renaming that domain would lock every existing manager out — it stays",
  slotEmail(LEAGUE, "HELX").endsWith("@gridiron.invalid"),
);

eq("the slot is lower-cased, so case cannot fork an account",
  slotEmail(LEAGUE, "helx"), slotEmail(LEAGUE, "HELX"));

// Two franchises in one league, and the same franchise in two leagues, are
// four different people. Neither half of the key is decoration.
ok("two slots in one league are two addresses",
  slotEmail(LEAGUE, "HELX") !== slotEmail(LEAGUE, "STL"));
ok("and one slot in two leagues is two more",
  slotEmail(LEAGUE, "HELX") !== slotEmail("3f8a1c22-0000-4000-8000-000000000002", "HELX"));

console.log("\n--- a PIN is four digits ---");

ok("four digits is a PIN", isValidPin("0000"));
ok("and so is one with leading zeroes", isValidPin("0042"));
ok("three is not", !isValidPin("123"));
ok("five is not", !isValidPin("12345"));
ok("letters are not", !isValidPin("12a4"));
ok("nor is a number, which is what a JSON body would carry", !isValidPin(1234));
ok("nor nothing at all", !isValidPin(undefined));

console.log("\n--- comparing them gives nothing away by timing ---");

ok("equal strings match", safeEqual("abcd", "abcd"));
ok("different ones do not", !safeEqual("abcd", "abce"));
// Different lengths must not throw: timingSafeEqual refuses unequal buffers,
// so the length is checked first rather than left to raise.
ok("and lengths that differ are simply false", !safeEqual("abcd", "abcdef"));

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
