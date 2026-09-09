/**
 * Does the page say why a move is refused?
 *
 * The database refuses these whatever the page does. This is the other half:
 * a button that always fails is worse than no button, because a manager who
 * cannot see why concludes the app is broken.
 */
import { chromium } from "playwright";
import { routes } from "./fixture.mjs";
import { sessionCookie } from "./session.mjs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3123";
let failed = 0;
const ok = (label, got) => { console.log(`${got ? "PASS" : "FAIL"}  ${label}`); if (!got) failed++; };

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addCookies([sessionCookie()]);
const page = await ctx.newPage();
await routes(page);

await page.goto(`${BASE}/free-agents`, { waitUntil: "networkidle" });
await page.waitForTimeout(700);
const body = await page.locator("body").innerText();

console.log("--- a free agent who is playing ---");
ok("his row says he is locked", /playing now, locked until next week/i.test(body));
{
  const locked = page.locator('button:has-text("Locked")');
  const n = await locked.count();
  ok(`his button says so too (${n} of them)`, n >= 1);
  ok("and it cannot be pressed", await locked.first().isDisabled());
}
ok("while a free agent still to play can be added",
  await page.locator('button:has-text("Add"), button:has-text("Claim")').first().isEnabled());

console.log("\n--- and one of your own who is playing ---");
ok("his row says he is locked", /playing, locked/i.test(body));
{
  const rows = await page.locator('text=/Jahmyr Gibbs/').count();
  ok(`he is on the roster list (${rows})`, rows >= 1);
}
ok("a player still to play can still be dropped",
  await page.locator('button:has-text("Drop")').first().isEnabled());

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
