/**
 * Does the week recap — v2, the broadcast cut — play, say true things, and get
 * out of the way?
 *
 * The failures worth catching do not show in the markup:
 *
 * A keyframe written into a style the clock re-applies never leaves its first
 * frame, and most of these start at zero opacity — so the failure is a recap
 * that is correct in the DOM and invisible on screen. Animation assertions read
 * the computed animation name and the painted opacity.
 *
 * Win and loss are different motion, not one animation in two colours.
 *
 * A recap that plays every launch is a door in the way of the app, so the seen
 * marker is checked both ways round.
 *
 * And every sentence branches. The fixture is built so the ones that fire are
 * known: a win by 13.2, somebody else's high score, an MVP who is not first in
 * the list and carried more than a quarter of the week, a climb from 7th to
 * 6th, and a rematch next week.
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
async function open({ unseen = true, reducedMotion = "no-preference", width = 402, height = 874, recap = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true, reducedMotion });
  await ctx.addCookies([sessionCookie()]);
  const page = await ctx.newPage();
  await routes(page, { recapUnseen: unseen });
  if (recap) {
    await page.route("**/api/recap", (r) =>
      r.request().method() === "GET" ? r.fulfill({ json: recap }) : r.fulfill({ json: { seenWeek: 3, stored: true } }));
  }
  await page.goto(`${BASE}/lineup`, { waitUntil: "networkidle" });
  if (unseen) await page.waitForSelector('[role="dialog"][aria-label="Week 3 recap"]', { timeout: 20000 }).catch(() => {});
  return { page, ctx };
}

const stage = (page) => page.locator('[role="dialog"][aria-label="Week 3 recap"]');
const beat = (page, n) => page.locator(`[data-beat="${n}"]`);
/** What is painted on a node: the animation running and its opacity. */
const paint = (page, selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el);
    return { animation: s.animationName, opacity: Number(s.opacity) };
  }, selector);
/** Tap the stage in an empty spot (not on a button). */
const tap = (page) => page.mouse.click(200, 820);

console.log("--- it plays, once ---");
let page, ctx;
{
  // The seen case first: the recap's clock runs from the moment it opens, so
  // the playing one is opened last, just before its beats are read.
  const seen = await open({ unseen: false });
  await seen.page.waitForTimeout(1500);
  ok("a manager who has seen it gets the app", (await stage(seen.page).count()) === 0);
  ok("and the matchup is really there", /WIN PROB/.test(await seen.page.locator("body").innerText()));
  await seen.ctx.close();

  ({ page, ctx } = await open());
  ok("the recap takes the screen on the first open after the week", (await stage(page).count()) === 1);
  ok("and says which week it is recapping", /WEEK 3/.test(await stage(page).innerText()));
  // Over everything, the tab bar included.
  const onTop = await page.evaluate(() => {
    const el = document.elementFromPoint(200, 850);
    return !!el?.closest('[role="dialog"]');
  });
  ok("on top of the tab bar", onTop);
}

console.log("\n--- beat one: the result ---");
{
  await page.waitForTimeout(1600);
  const t = await beat(page, 1).innerText();
  ok("both franchises", /Steel Cartel/.test(t) && /Bay Area Brawlers/.test(t));
  ok("the scores, counted all the way up", /131\.6/.test(t) && /118\.4/.test(t));
  ok(`the verdict line (${t.match(/Won by[^\n]*/)?.[0]})`, /Won by 13\.2 · now 2-1 · W1/.test(t));
  const win = await paint(page, '[data-verdict="win"]');
  ok(`WIN slams in (${win?.animation})`, win?.animation === "r2-slam");
  ok("and is visible", (win?.opacity ?? 0) > 0.9);
  ok("with light streaks across it", (await page.locator("[data-streak]").count()) === 1);
  ok("and no loss band", (await page.locator('[data-verdict="loss"], [data-shade]').count()) === 0);
  // Somebody else's high score, and where yours sat.
  ok("the week's high score is somebody else's", /HIGH SCORE OF THE WEEK\n/.test(t) && /152\.9/.test(t));
  ok("and says where yours came", /Your 131\.6 was \d+(st|nd|rd|th) of 12/.test(t));
}

console.log("\n--- a tap cuts to the next beat, behind the stinger ---");
{
  await tap(page);
  await page.waitForTimeout(150);
  ok("the stinger covers the cut", (await page.locator("[data-sting]").count()) === 1);
  const sting = await paint(page, "[data-sting] > div");
  ok(`and it is the wipe (${sting?.animation})`, sting?.animation === "r2-sting");
  // Past the points count-up, which ends 1.35s into the beat.
  await page.waitForTimeout(1900);
  ok("then beat two is up", (await beat(page, 2).count()) === 1);
}

console.log("\n--- beat two: your MVP ---");
{
  const t = await beat(page, 2).innerText();
  // Jayden Daniels, 34.7 — not Bijan, who is first in the list.
  ok("the MVP is whoever scored most, not the first listed", /DANIELS/.test(t) && /34\.7/.test(t));
  ok("his share of the week", /PTS · 26% OF YOUR WEEK/.test(t));
  ok("and the note branches on it", /Carried the week almost alone\. Next best: Ja'Marr Chase, 27\.8\./.test(t));
  ok("with the next three behind him", /Chase/.test(t) && /Robinson/.test(t) && /Gibbs/.test(t));
}

console.log("\n--- beat three: the playoff picture ---");
{
  await tap(page);
  await page.waitForTimeout(2000);
  const t = await beat(page, 3).innerText();
  ok("the seed after the week", /\b6\b/.test(t));
  ok(`the move (${t.match(/▲ \d|▼ \d|HELD/)?.[0]})`, /▲ 1/.test(t) && /Up from 7th/.test(t));
  ok("and the division", /in the North/.test(t));
  ok("the magic number", /MAGIC NUMBER/.test(t) && /Any combination of \d+ of your wins/.test(t));
  ok("a rail of all twelve seeds", (await beat(page, 3).locator("text=/^12$/").count()) === 1);
}

console.log("\n--- beat four: the share card, and out ---");
{
  let marked = null;
  await page.route("**/api/recap", async (r) => {
    if (r.request().method() === "POST") {
      marked = JSON.parse(r.request().postData() ?? "{}");
      return r.fulfill({ json: { seenWeek: 3, stored: true } });
    }
    return r.fallback();
  });
  await tap(page);
  await page.waitForTimeout(1500);
  const t = await beat(page, 4).innerText();
  ok("the result on the card", /WIN/.test(t) && /131\.6 – 118\.4/.test(t));
  ok("next week's opponent and the rematch", /NEXT · WEEK 4/.test(t) && /Rematch: you won the first meeting/.test(t));
  ok("share and done", (await page.getByRole("button", { name: "SHARE" }).count()) === 1 && (await page.getByRole("button", { name: "DONE" }).count()) === 1);

  await page.getByRole("button", { name: "DONE" }).click();
  await page.waitForTimeout(1000);
  ok("done closes it", (await stage(page).count()) === 0);
  ok("the matchup is underneath it", /WIN PROB/.test(await page.locator("body").innerText()));
  ok(`and the week is marked seen (${JSON.stringify(marked)})`, marked?.week === 3);
  await ctx.close();
}

console.log("\n--- a loss is not a win in amber ---");
{
  const lost = JSON.parse(JSON.stringify(RECAP));
  lost.seenWeek = null;
  for (const g of lost.recap.games) {
    if (g.week === 3 && g.home === "m0") [g.homePoints, g.awayPoints] = [g.awayPoints, g.homePoints];
  }
  const loss = await open({ recap: lost });
  await loss.page.waitForTimeout(1900);
  const t = await beat(loss.page, 1).innerText();
  ok("it says you lost", /LOSS/.test(t) && /Lost by 13\.2/.test(t));
  const drop = await paint(loss.page, '[data-verdict="loss"]');
  ok(`LOSS falls in rather than slamming (${drop?.animation})`, drop?.animation === "r2-drop");
  ok("and is visible", (drop?.opacity ?? 0) > 0.9);
  ok("no streaks on a loss", (await loss.page.locator("[data-streak]").count()) === 0);
  const shade = await paint(loss.page, "[data-shade]");
  ok(`a dark band descends instead (${shade?.animation})`, shade?.animation === "r2-shade");
  await loss.ctx.close();
}

console.log("\n--- on a small phone, and on its own ---");
{
  // The design is a 402×874 phone; on a smaller one the whole stage scales.
  const small = await open({ width: 320, height: 568 });
  const box = await small.page.evaluate(() => {
    const stageEl = document.querySelector('[role="dialog"] > div');
    const r = stageEl?.getBoundingClientRect();
    return r ? { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight } : null;
  });
  ok(`the stage fits the screen (${JSON.stringify(box)})`, !!box && box.w <= box.vw + 1 && box.h <= box.vh + 1);

  // Left alone, it closes itself at 12.4s and marks the week seen.
  let marked = null;
  await small.page.route("**/api/recap", async (r) => {
    if (r.request().method() === "POST") {
      marked = JSON.parse(r.request().postData() ?? "{}");
      return r.fulfill({ json: { seenWeek: 3, stored: true } });
    }
    return r.fallback();
  });
  await small.page.waitForFunction(() => !document.querySelector('[role="dialog"][aria-label="Week 3 recap"]'), undefined, { timeout: 20000 }).catch(() => {});
  ok("it closes on its own", (await stage(small.page).count()) === 0);
  ok("and marks the week seen", marked?.week === 3);
  await small.ctx.close();
}

console.log("\n--- asked for less motion ---");
{
  const still = await open({ reducedMotion: "reduce" });
  await still.page.waitForTimeout(300);
  const win = await paint(still.page, '[data-verdict="win"]');
  ok(`the verdict is simply there (${win?.animation})`, win?.animation === "none" && (win?.opacity ?? 0) > 0.9);
  ok("the scores are already counted", /131\.6/.test(await beat(still.page, 1).innerText()));
  await tap(still.page);
  await still.page.waitForTimeout(150);
  ok("and the cut has no stinger", (await still.page.locator("[data-sting]").count()) === 0);
  await still.ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
