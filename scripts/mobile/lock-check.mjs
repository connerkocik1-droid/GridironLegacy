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

// Your own players' moves live in the player sheet now (the three-tab
// redesign), so this is asked of the sheet a roster row opens.
console.log("\n--- and one of your own, from his player sheet ---");
const openSheet = async (name) => {
  await page.locator(".gl-row", { hasText: name }).first().click();
  await page.locator('[role="dialog"][aria-modal="true"]').waitFor({ timeout: 15000 });
  await page.waitForTimeout(600);
  return page.locator('[role="dialog"][aria-modal="true"]');
};
const closeSheet = async () => {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
};

await page.goto(`${BASE}/my-team`, { waitUntil: "networkidle" });
await page.waitForTimeout(700);
{
  const sheet = await openSheet("Jahmyr Gibbs");
  ok("a player still to play can be dropped",
    (await sheet.locator('button:has-text("DROP")').count()) === 1);
  await closeSheet();
}

// The same man once his club has kicked off.
const served = await page.evaluate(() => fetch("/api/player/Jahmyr%20Gibbs").then((r) => r.json()));
served.actions = { ...(served.actions ?? {}), where: "mine", locked: true };
await page.route("**/api/player/**", (route) => route.fulfill({ json: served }));
{
  const sheet = await openSheet("Jahmyr Gibbs");
  const text = await sheet.innerText();
  ok("once his game starts there is no Drop", (await sheet.locator('button:has-text("DROP")').count()) === 0);
  ok("and the sheet says why", /Drop locks once his game kicks off/i.test(text));
  ok("while Trade is still on offer", /TRADE/.test(text));
  await closeSheet();
}

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
