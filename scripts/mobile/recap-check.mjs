/**
 * Does the week recap play, say true things, and get out of the way?
 *
 * Four things are worth catching here and none of them shows up in the markup:
 *
 * A keyframe written into a re-applied style attribute never leaves its first
 * frame, and most of these start at zero opacity — so the failure is a recap
 * that is perfectly correct in the DOM and invisible on the screen. Every
 * animation assertion below reads the computed animation name and the painted
 * opacity, not the class list.
 *
 * Win and loss have to be different motion, not one animation in two colours.
 *
 * A recap that plays every launch is a door in the way of the app, so the
 * seen marker is checked both ways round.
 *
 * And every sentence branches. The fixture's table is built so the branches
 * that fire are known ones: a win by 13.2, somebody else's crown, an MVP who
 * is not first in the list, and a rematch next week.
 */
import { chromium } from "playwright";
import { RECAP, routes } from "./fixture.mjs";
import { sessionCookie } from "./session.mjs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3123";
let failed = 0;
const ok = (label, got) => { console.log(`${got ? "PASS" : "FAIL"}  ${label}`); if (!got) failed++; };

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});

/** A phone with the recap waiting, or already seen. */
async function open({ unseen = true, reducedMotion = "no-preference", width = 402 } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 }, isMobile: true, hasTouch: true, reducedMotion,
  });
  await ctx.addCookies([sessionCookie()]);
  const page = await ctx.newPage();
  await routes(page, { recapUnseen: unseen });
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  return { page, ctx };
}

const stage = (page) => page.locator(".gl-recap");

/**
 * Put the recap on a beat and hold the assertions inside that beat's window.
 *
 * The clock keeps running after a jump, which is the point of the feature and
 * a hazard for a check: an assertion made four seconds later is an assertion
 * about whichever beat happens to be up. Every block below jumps first and
 * reads inside the beat it asked for.
 */
const toBeat = async (page, n) => {
  await page.getByLabel(`Beat ${n + 1} of 4`).click();
  await page.waitForTimeout(120);
};
const text = (page) => stage(page).innerText();

/** What is actually painted on a node: the animation running and its opacity. */
const paint = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    return { animation: s.animationName, opacity: Number(s.opacity) };
  }, selector);

console.log("--- it plays, once ---");
let page, ctx;
{
  ({ page, ctx } = await open());
  ok("the recap takes the screen on the first open after the week", await stage(page).count() === 1);
  ok("and says which week it is recapping", /WEEK 3 · FINAL/.test(await text(page)));

  const seen = await open({ unseen: false });
  ok("a manager who has seen it gets Home", await seen.page.locator(".gl-recap").count() === 0);
  ok("and Home is really there behind it", /HERE NOW/.test(await seen.page.locator("body").innerText()));
  await seen.ctx.close();
}

console.log("\n--- beat one: the result ---");
{
  await toBeat(page, 0);
  const t = await text(page);
  ok("it says you won", /\bWON\b/.test(t) && !/\bLOST\b/.test(t));

  // The stamp is the win's own keyframe. Reading the class would pass on a
  // recap that never painted; reading the computed animation would not.
  const stamp = await paint(page, ".gl-recap .rc-stamp");
  ok(`the verdict is stamped, not faded (${stamp?.animation})`, stamp?.animation === "rc-stamp");
  ok("and it is actually visible", (stamp?.opacity ?? 0) > 0.9);
  ok("a win has no falling verdict", (await page.locator(".gl-recap .rc-drop").count()) === 0);

  // Energy from below: rays and embers exist on a win and nowhere else.
  const rays = await paint(page, ".gl-recap .rc-rays");
  ok(`a win fires the rays (${rays?.animation})`, rays?.animation === "rc-rays");
  ok("and the embers", (await page.locator(".gl-recap .rc-spark").count()) === 8);
  ok("with no amber band over it", (await page.locator(".gl-recap .rc-shade").count()) === 0);

  // The scores count up rather than appearing. Two reads, a moment apart, both
  // inside this beat's four seconds.
  const scoreNow = async () => Number((await text(page)).match(/(\d+\.\d)\s*\n\s*VS/)?.[1] ?? 0);
  await page.waitForTimeout(1000);
  const first = await scoreNow();
  await page.waitForTimeout(600);
  const second = await scoreNow();
  ok(`the score counts up (${first} then ${second})`, second > first && first > 0);

  await page.waitForTimeout(1100);
  const settled = await text(page);
  ok("and lands on what was actually scored", /131\.6/.test(settled));
  ok("by the real margin", /Won by 13\.2/.test(settled));
  ok("the streak strip reads the season", /Back in the win column · 2-1 on the season/.test(settled));
}

console.log("\n--- and it advances on its own ---");
{
  // The clock is an interval rather than requestAnimationFrame, because rAF is
  // throttled to nothing in a hidden document and this fires on app open. What
  // that buys is exactly this: the recap moves without being touched.
  const before = await text(page);
  await page.waitForTimeout(1800);
  const after = await text(page);
  ok("the next beat arrives without a tap",
    before !== after && /HIGHEST SCORE OF THE WEEK/.test(after));
}

console.log("\n--- beat two: the week's best ---");
{
  await toBeat(page, 1);
  const t = await text(page);
  ok("it names the franchise that posted it", /Kim's Very Long Franchise Name/.test(t));
  ok("and does not pretend it was you", !/THAT WAS YOU/.test(t));
  ok("it places you against it", /came in 4th of 12/.test(t));
  ok("with the gap to second", /17\.2 clear of second/.test(t));

  const crown = await paint(page, ".gl-recap .rc-crown");
  ok(`the crown lands (${crown?.animation})`, crown?.animation === "rc-crown");
  ok("and is visible when it has", (crown?.opacity ?? 0) > 0.9);
  ok("the scoreboard is under it", /WEEK 3 SCOREBOARD/.test(t));

  await page.waitForTimeout(2200);
  ok("and the top score settles on the real number", /152\.9/.test(await text(page)));
}

console.log("\n--- beat three: your MVP ---");
{
  await toBeat(page, 2);
  const t = await text(page);
  // The fixture lists Bijan first and Daniels third. An MVP taken off the top
  // of the list rather than off the top of the scoring would be Bijan.
  ok("the MVP is the top scorer, not the first man listed",
    /Jayden Daniels/.test(t) && /YOUR WEEK 3 MVP/.test(t));
  ok("with his share of the week", /26% OF YOUR POINTS/.test(t));
  ok("and a note that reads the share",
    /Carried the week almost alone — no other player of yours cleared 27\.8/.test(t));
  ok("the contribution list is there", /WHO CARRIED IT/.test(t));

  const card = await paint(page, ".gl-recap .rc-pop");
  ok(`the card pops in (${card?.animation})`, card?.animation === "rc-pop");
}

console.log("\n--- beat four: where it leaves you ---");
{
  await toBeat(page, 3);
  const t = await text(page);
  ok("it shows the move, both ends of it", /#7/.test(t) && /#6/.test(t));
  ok("and which way that is", /UP 1/.test(t));
  ok("with a note that reads the direction", /Climbed to 6 of 12/.test(t));
  ok("next week's opponent is named", /Bay Area Brawlers/.test(t));
  ok("with their record", /1-2/.test(t));
  ok("and a read that knows you have met", /already seen them once/.test(t));
  ok("and how they score against you", /22\.7 more points scored than you/.test(t));
}

console.log("\n--- and it gets out of the way ---");
{
  let marked = null;
  await page.route("**/api/recap", async (r) => {
    if (r.request().method() === "POST") {
      marked = JSON.parse(r.request().postData() ?? "{}");
      return r.fulfill({ json: { seenWeek: 3, stored: true } });
    }
    return r.fallback();
  });

  await toBeat(page, 3);
  // The card it sits in slides in; a click on a moving target never resolves.
  await page.waitForTimeout(800);
  await page.getByRole("button", { name: "TAKE ME HOME" }).click();
  await page.waitForTimeout(1400);
  ok("the recap leaves", (await stage(page).count()) === 0);
  ok("Home is underneath it", /HERE NOW/.test(await page.locator("body").innerText()));
  ok(`and the week is marked seen (${JSON.stringify(marked)})`, marked?.week === 3);

  // Nothing is left holding the page still.
  const locked = await page.evaluate(() => getComputedStyle(document.body).overflow);
  ok(`the page scrolls again (${locked})`, locked !== "hidden");
  await ctx.close();
}

console.log("\n--- a loss is not a win in amber ---");
{
  // The same week turned round. Built here rather than fetched through the
  // fixture, because a route that re-fetches goes to the real server and gets
  // a real answer, which is not the one under test.
  const lost = JSON.parse(JSON.stringify(RECAP));
  lost.seenWeek = null;
  for (const g of lost.recap.games) {
    if (g.week === 3 && g.home === "m0") {
      const swap = g.homePoints;
      g.homePoints = g.awayPoints;
      g.awayPoints = swap;
    }
  }

  const loss = await open();
  await loss.page.route("**/api/recap", (r) =>
    r.request().method() === "GET"
      ? r.fulfill({ json: lost })
      : r.fulfill({ json: { seenWeek: 3, stored: true } }));
  await loss.page.reload({ waitUntil: "networkidle" });
  await loss.page.waitForTimeout(600);

  const t = await loss.page.locator(".gl-recap").innerText();
  ok("it says you lost", /\bLOST\b/.test(t) && !/\bWON\b/.test(t));

  const drop = await paint(loss.page, ".gl-recap .rc-drop");
  ok(`the verdict falls in rather than stamping (${drop?.animation})`, drop?.animation === "rc-drop");
  ok("and it is visible", (drop?.opacity ?? 0) > 0.9);
  ok("there is no stamp on a loss", (await loss.page.locator(".gl-recap .rc-stamp").count()) === 0);

  // The absence is the contrast: no rays, no embers, and an amber band instead.
  ok("no rays", (await loss.page.locator(".gl-recap .rc-rays").count()) === 0);
  ok("no embers", (await loss.page.locator(".gl-recap .rc-spark").count()) === 0);
  const shade = await paint(loss.page, ".gl-recap .rc-shade");
  ok(`an amber band descends instead (${shade?.animation})`, shade?.animation === "rc-shade");
  await loss.ctx.close();
}

console.log("\n--- on the narrowest phone there is ---");
{
  // The recap is not in the layout audit's sweep — it is behind a seen marker
  // on every page that audit visits — so its widths are measured here. A
  // takeover that runs off the side of a 320px screen is a takeover that took
  // the screen and then lost half of it.
  const small = await open({ width: 320 });
  const beats = ["Beat 1 of 4", "Beat 2 of 4", "Beat 3 of 4", "Beat 4 of 4"];
  for (let n = 0; n < beats.length; n++) {
    await small.page.getByLabel(beats[n]).click();
    await small.page.waitForTimeout(200);
    const over = await small.page.evaluate(() => {
      const root = document.querySelector(".gl-recap");
      if (!root) return null;
      let worst = 0;
      for (const el of root.querySelectorAll("*")) {
        const box = el.getBoundingClientRect();
        if (!box.width) continue;
        // Ignore what is deliberately painted past the edge: the glow, the
        // ray burst and the amber band are all wider than the phone on
        // purpose, and none of them can be scrolled to.
        if (getComputedStyle(el).pointerEvents === "none") continue;
        worst = Math.max(worst, Math.ceil(box.right - window.innerWidth), Math.ceil(-box.left));
      }
      return worst;
    });
    ok(`beat ${n + 1} stays inside 320px (${over}px over)`, over === 0);
  }
  ok("and the page itself does not scroll sideways",
    (await small.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)) <= 0);
  await small.ctx.close();
}

console.log("\n--- asked for less motion ---");
{
  const still = await open({ reducedMotion: "reduce" });
  const t = await still.page.locator(".gl-recap").innerText();
  ok("the recap still plays", /WEEK 3 · FINAL/.test(t));

  // The end state, immediately: the count-up is skipped rather than started.
  ok("the score is the score, not a number climbing to it", /131\.6/.test(t));

  const stamp = await paint(still.page, ".gl-recap .rc-stamp");
  ok(`nothing is animating (${stamp?.animation})`, stamp?.animation === "none");
  ok("and the verdict is still on the screen", (stamp?.opacity ?? 0) > 0.9);
  ok("the rays are gone rather than frozen", (await still.page.locator(".gl-recap .rc-rays").isVisible().catch(() => false)) === false);
  await still.ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
