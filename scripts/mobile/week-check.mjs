/**
 * Does the commissioner's switch actually end the week?
 *
 * The one control in the office that changes what every other screen says, so
 * three things are worth checking and only one of them is the button.
 *
 * That it refuses a week nobody has been scored in — closing one of those
 * writes a tie into every fixture in the league and calls it a result, and a
 * recorded result is the one thing this app will not recompute.
 *
 * That the recap follows it. The recap plays the first time somebody opens the
 * app after a week is closed, so the trigger is the lock rather than a
 * calendar Tuesday, and the two have to agree about which week that was.
 *
 * And that the ticker and the games page ask for the league's week rather than
 * whatever ESPN has live. A league still on week one should be looking at week
 * one's football.
 */
import { chromium } from "playwright";
import { RECAP, routes } from "./fixture.mjs";
import { sessionCookie } from "./session.mjs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3123";
let failed = 0;
const ok = (label, got) => { console.log(`${got ? "PASS" : "FAIL"}  ${label}`); if (!got) failed++; };

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});

async function open(over = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 402, height: 900 }, isMobile: true, hasTouch: true,
  });
  await ctx.addCookies([sessionCookie()]);
  const page = await ctx.newPage();
  await routes(page, over);
  return { page, ctx };
}

const office = async (page) => {
  await page.goto(`${BASE}/commissioner`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => /The week/.test(document.body.innerText), undefined, { timeout: 20000 })
    .catch(() => {});
  return page.locator("#office-week");
};

console.log("--- the office says what it would close ---");
let page, ctx;
{
  ({ page, ctx } = await open());
  const card = await office(page);
  const t = await card.innerText();

  ok("the card is there", (await card.count()) === 1);
  ok("it names the week the league is on", /week 2/i.test(t));
  ok("and how much is behind it", /1 week settled behind it/.test(t));
  ok("it says what would close", /6 fixtures would close/.test(t));
  ok("and that the recap follows", /recap of week 2 plays the next time/.test(t));
  ok("the button names the week rather than saying 'advance'",
    (await page.getByRole("button", { name: "Lock week 2 and advance" }).count()) === 1);

  // A takeover nobody can undo should say so before it is pressed, not after.
  ok("and it warns that a settled week is never recomputed",
    /never recomputed/.test(t));
}

console.log("\n--- and it will not close an empty one ---");
{
  const empty = await open({ season: { week: 4, openFixtures: 6, scored: 0, weeks: 13, settled: 3 } });
  const card = await office(empty.page);
  const t = await card.innerText();

  ok("it says there is nothing to lock in", /Nobody has been scored in this week yet/.test(t));
  ok("and the button is refused rather than merely failing",
    await empty.page.getByRole("button", { name: /Lock week 4/ }).isDisabled());
  await empty.ctx.close();
}

console.log("\n--- a season with nothing left ---");
{
  const over = await open({ season: { week: null, openFixtures: 0, scored: 0, weeks: 13, settled: 13 } });
  const card = await office(over.page);
  const t = await card.innerText();
  ok("says so rather than offering a button", /Every week on the schedule has been settled/.test(t));
  ok("and offers none", (await over.page.getByRole("button", { name: /Lock week/ }).count()) === 0);
  await over.ctx.close();
}

console.log("\n--- pressing it ---");
{
  let sent = null;
  await page.route("**/api/admin/league**", async (r) => {
    if (r.request().method() === "PATCH") sent = JSON.parse(r.request().postData() ?? "{}");
    await r.fallback();
  });

  await page.getByRole("button", { name: "Lock week 2 and advance" }).click();
  await page.waitForFunction(() => /is settled/.test(document.body.innerText), undefined, { timeout: 15000 })
    .catch(() => {});

  const t = await page.locator("body").innerText();
  ok(`it asks the server to advance (${JSON.stringify(sent)})`, sent?.advanceWeek === true);
  ok("and says which week it closed", /Week 2 is settled/.test(t));
  ok("and where the league is now", /on week 3/.test(t));
  ok("and that everybody's recap is waiting", /recap of week 2 plays the next time/.test(t));

  // The card re-reads rather than being left saying what it said before.
  const card = await page.locator("#office-week").innerText();
  ok(`the card moves on with it (${card.split("\n")[1]?.slice(0, 40)})`, /week 3/i.test(card));
  await ctx.close();
}

console.log("\n--- and every screen follows the league's week ---");
{
  // Not ESPN's idea of what is live: a league whose commissioner has not
  // advanced past week one should be looking at week one's football.
  const asked = [];
  const watch = await open();
  watch.page.on("request", (r) => {
    if (r.url().includes("/api/scoreboard")) asked.push(new URL(r.url()).search);
  });

  await watch.page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await watch.page.waitForTimeout(700);
  ok(`the ticker asks for the league's week (${asked.join(" ")})`,
    asked.some((q) => q.includes("league=1")));

  asked.length = 0;
  await watch.page.goto(`${BASE}/games`, { waitUntil: "networkidle" });
  await watch.page.waitForTimeout(700);
  ok(`and so does the week's games (${asked.join(" ") || "none"})`,
    asked.some((q) => q.includes("league=1")));
  await watch.ctx.close();
}

console.log("\n--- the recap is triggered by the lock, not by a clock ---");
{
  // The recap's opensAt is the moment the week was closed. A recap whose week
  // has been locked and not seen plays on the next open; one locked in the
  // future — which is what a clock rule would produce — does not.
  const locked = await open();
  await locked.page.route("**/api/recap", (r) =>
    r.request().method() === "GET"
      ? r.fulfill({ json: { ...RECAP, seenWeek: null, opensAt: Date.now() - 1000 } })
      : r.fulfill({ json: { seenWeek: 3, stored: true } }));
  await locked.page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await locked.page.waitForTimeout(600);
  ok("a week just locked plays its recap",
    (await locked.page.locator(".gl-recap").count()) === 1);
  await locked.ctx.close();

  const soon = await open();
  await soon.page.route("**/api/recap", (r) =>
    r.request().method() === "GET"
      ? r.fulfill({ json: { ...RECAP, seenWeek: null, opensAt: Date.now() + 3_600_000 } })
      : r.fulfill({ json: { seenWeek: 3, stored: true } }));
  await soon.page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await soon.page.waitForTimeout(600);
  ok("and a week not yet locked does not",
    (await soon.page.locator(".gl-recap").count()) === 0);
  await soon.ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
