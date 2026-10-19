/**
 * Does sixteen-bit mode actually apply, and does it break anything?
 *
 * A skin is the one kind of change that touches every screen and is checked by
 * nothing: the layout audit loads the modern look, the unit tests never see
 * CSS, and a palette that reads well in a stylesheet can still put white text
 * on white. So this drives the real pages through the real switch in the
 * avatar menu and asks the questions that can actually fail:
 *
 *   Does every launch start modern, and does a reload keep it on?
 *   Did the palette, the type and the geometry take?
 *   Are the images still there — pixelated, not hidden or swapped?
 *   Do the cues fire: BLIP on a tab, TOUCHDOWN on a scoring jump?
 *   Is it silent? There is no audio anywhere in the skin.
 *   Does anything overflow, at 390 and at 320?
 *
 * Screenshots go to .mobile-audit when --shots is on, because the rest of this
 * is arithmetic and somebody still has to look at it.
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { routes } from "./fixture.mjs";
import { sessionCookie } from "./session.mjs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3123";
const SHOTS = process.env.AUDIT_SHOTS ?? "";
let failed = 0;
const ok = (label, cond, note = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${note ? ` — ${note}` : ""}`);
  if (!cond) failed++;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
if (SHOTS) await mkdir(SHOTS, { recursive: true });

// Headshots come from ESPN's CDN, which this sandbox cannot reach. Answering
// it with a real PNG means faces load, so the check can see that they are
// still on screen and are going through the filter.
const FACE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAXUlEQVR42u3QMQEAAAjDMMC/56EB" +
  "3RJInbTVAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAg" +
  "QIAAAQIECBAgQIDAjwUXHAABm2JhGwAAAABJRU5ErkJggg==",
  "base64",
);

async function open({ width = 390, height = 844, reducedMotion = "no-preference" } = {}) {
  const ctx = await browser.newContext({
    viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion,
  });
  await ctx.addCookies([sessionCookie()]);
  // Every play() the page attempts. The skin's cues are visual only.
  await ctx.addInitScript(() => {
    window.__plays = 0;
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function play(...args) {
      window.__plays += 1;
      return orig.apply(this, args);
    };
  });
  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(120_000);
  await routes(page);
  await page.route("**a.espncdn.com/**", (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: FACE }));
  return { ctx, page };
}

const avatar = ".gl-nav button[aria-haspopup='dialog']";

/** Flip it the way a manager does: the first row of the avatar menu. */
async function flip(page) {
  await page.locator(avatar).click();
  await page.locator("[role='dialog'] [role='switch']").first().click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
}

const retroOn = (page) => page.evaluate(() => document.documentElement.dataset.retro === "1");

// ------------------------------------------------------------- the switch
console.log("===== the switch");
const { ctx, page } = await open();
{
  await page.goto(`${BASE}/lineup`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  ok("a launch starts modern", !(await retroOn(page)));

  await page.locator(avatar).click();
  const menu = await page.evaluate(() => {
    const dialog = document.querySelector("[role='dialog']");
    const first = dialog?.querySelector("[role='switch']");
    // Every row control, less the panel's own close button.
    const rows = [...(dialog?.querySelectorAll("a, button") ?? [])].filter((b) => b.getAttribute("aria-label") !== "Close");
    return {
      label: first?.closest("div")?.parentElement?.textContent ?? "",
      checked: first?.getAttribute("aria-checked"),
      // The switch is the first row under the franchise header.
      firstRow: Boolean(first) && rows[0] === first,
      appearance: [...(dialog?.querySelectorAll("[aria-label='Appearance'] button") ?? [])]
        .map((b) => b.textContent?.trim()),
    };
  });
  ok("the avatar menu's first row is the switch",
    menu.firstRow && /16-bit mode/.test(menu.label), JSON.stringify(menu));
  ok("and it is off", menu.checked === "false");
  // Appearance opens in place, like every row in the menu.
  await page.locator("[role='dialog'] button", { hasText: "Appearance" }).click();
  menu.appearance = await page.evaluate(() =>
    [...document.querySelectorAll("[role='dialog'] [aria-label='Appearance'] button")].map((b) => b.textContent?.trim()));
  ok(`Appearance is a brightness again (${menu.appearance.join(", ")})`,
    JSON.stringify(menu.appearance) === JSON.stringify(["System", "Light", "Dark"]));
  await page.keyboard.press("Escape");

  await flip(page);
  ok("pressing it turns the skin on", await retroOn(page));

  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  ok("a reload in the same session keeps it", await retroOn(page));

  const cold = await open();
  await cold.page.goto(`${BASE}/lineup`, { waitUntil: "networkidle" });
  ok("a cold launch is modern again", !(await retroOn(cold.page)));
  // A "16bit" the old Appearance picker left behind is not a way in.
  await cold.page.evaluate(() => localStorage.setItem("pylon:theme", "16bit"));
  await cold.page.reload({ waitUntil: "networkidle" });
  const stale = await cold.page.evaluate(() => ({
    retro: document.documentElement.dataset.retro ?? "",
    theme: document.documentElement.dataset.theme,
  }));
  ok("an old stored 16bit theme reads as an ordinary one",
    stale.retro === "" && (stale.theme === "dark" || stale.theme === "light"), JSON.stringify(stale));
  await cold.ctx.close();
}

// ------------------------------------------------------------ every screen
for (const [label, url] of [["matchup", "/lineup"], ["roster", "/my-team"], ["standings", "/standings"],
  ["players", "/players"], ["gamecast", "/games"]]) {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  const m = await page.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const panel = document.querySelector("[style*='--gl-panel']");
    const imgs = [...document.querySelectorAll("img")].filter((i) => i.getBoundingClientRect().width > 0);
    const crest = document.querySelector(".gl-crest");
    return {
      retro: root.dataset.retro,
      bg: cs.getPropertyValue("--bg").trim(),
      accent: cs.getPropertyValue("--accent-solid").trim(),
      radius: cs.getPropertyValue("--radius-lg").trim(),
      body: getComputedStyle(document.body).fontFamily,
      heading: cs.getPropertyValue("--font-heading").trim(),
      panel: Boolean(panel),
      panelBorder: panel ? getComputedStyle(panel).borderTopColor : "",
      panelWidth: panel ? getComputedStyle(panel).borderTopWidth : "",
      panelBlur: panel ? getComputedStyle(panel).backdropFilter : "none",
      glow: (() => {
        const g = document.querySelector("[data-glow]");
        return g ? getComputedStyle(g).display : "absent";
      })(),
      images: imgs.length,
      filtered: imgs.filter((i) => getComputedStyle(i).filter.includes("px16")).length,
      hidden: imgs.filter((i) => getComputedStyle(i).visibility === "hidden" || getComputedStyle(i).opacity === "0").length,
      filter: Boolean(document.querySelector("filter#px16")),
      crest: Boolean(crest),
      crestRadius: crest ? getComputedStyle(crest).borderTopLeftRadius : "",
      scan: (() => {
        const s = document.querySelector(".gl-px-scan");
        return s ? getComputedStyle(s).pointerEvents : "absent";
      })(),
      badge: document.querySelector(".gl-px-badge")?.textContent ?? "",
      sprites: document.querySelectorAll(".gl-px-sprite").length,
      audio: document.querySelectorAll("audio").length,
      plays: window.__plays,
      scroll: root.scrollWidth,
      width: window.innerWidth,
    };
  });

  console.log(`\n===== ${label} (${url})`);
  ok("the skin is on", m.retro === "1");
  ok("navy ground", m.bg === "#0b1440", m.bg);
  ok("gold accent", m.accent === "#f2c14e", m.accent);
  ok("square corners", m.radius === "0px", m.radius);
  ok("Pixelify Sans for body text", m.body.startsWith('"Pixelify Sans"'), m.body);
  ok("Silkscreen for headings", m.heading.startsWith('"Silkscreen"'), m.heading);
  if (m.panel) {
    ok(`panels are gold-bordered (${m.panelBorder} ${m.panelWidth})`,
      m.panelBorder === "rgb(242, 193, 78)" && m.panelWidth === "2px");
    ok("and not glass", m.panelBlur === "none", m.panelBlur);
  }
  ok("the background glows are gone", m.glow === "none" || m.glow === "absent", m.glow);
  ok("the pixel filter is in the document", m.filter);
  ok(`every image goes through it (${m.filtered} of ${m.images})`, m.filtered === m.images);
  ok("and none is hidden", m.hidden === 0, String(m.hidden));
  if (m.crest) ok("a crest is square", m.crestRadius === "0px", m.crestRadius);
  ok("scanlines are up and take no taps", m.scan === "none", m.scan);
  ok(`the header carries the badge ("${m.badge}")`, m.badge === "●16");
  if (label === "gamecast") ok(`every game has a runner (${m.sprites})`, m.sprites > 0);
  ok("there is no audio at all", m.audio === 0 && m.plays === 0, `${m.audio} elements, ${m.plays} plays`);
  ok(`nothing runs off the side (${m.scroll}px)`, m.scroll <= m.width);

  if (SHOTS) await page.screenshot({ path: `${SHOTS}/16bit-${label}.png`, fullPage: true });
}

// -------------------------------------------------------------- the cues
console.log("\n===== ♪ BLIP");
{
  await page.goto(`${BASE}/lineup`, { waitUntil: "networkidle" });
  await page.waitForTimeout(500);
  await page.locator(".gl-tabbar a[href]:not([aria-current])").first().click();
  const blip = await page.waitForSelector(".gl-px-blip", { timeout: 1500 }).then(() => true).catch(() => false);
  ok("a tab press shows it", blip);
  await page.waitForTimeout(1200);
  ok("and it goes again", (await page.locator(".gl-px-blip").count()) === 0);
}

console.log("\n===== ♪ TOUCHDOWN! ♪");
{
  // The matchup as the fixture serves it, then the same matchup a minute
  // later with one of your players six points better off.
  await page.goto(`${BASE}/lineup`, { waitUntil: "networkidle" });
  await page.waitForTimeout(400);
  const base = await page.evaluate(() => fetch("/api/matchup").then((r) => r.json()));
  const later = structuredClone(base);
  const star = later.rows.find((r) => r.home)?.home;
  star.points = Math.round((star.points + 6.3) * 10) / 10;

  // Held on the first answer until the play is meant to happen: a dev build
  // runs every effect twice, so "the first request" is not one request.
  let scored = false;
  await page.route("**/api/matchup**", (r) => r.fulfill({ json: scored ? later : base }));
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  ok("nothing on the first reading", (await page.locator(".gl-px-fanfare").count()) === 0);

  // The board reloads on coming back to the foreground, the way a phone does.
  scored = true;
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  const fan = await page.waitForSelector(".gl-px-fanfare", { timeout: 4000 })
    .then((el) => el.textContent()).catch(() => null);
  ok(`a six-point play fires it (${fan})`, Boolean(fan) && fan.includes(`${star.name} +6.3`));
  if (SHOTS && fan) await page.screenshot({ path: `${SHOTS}/16bit-touchdown.png` });
  await page.waitForTimeout(3000);
  ok("and it closes on its own", (await page.locator(".gl-px-fanfare").count()) === 0);
  await page.unroute("**/api/matchup**");
}

// -------------------------------------------------------- less motion
console.log("\n===== reduced motion");
{
  const calm = await open({ reducedMotion: "reduce" });
  await calm.page.goto(`${BASE}/lineup`, { waitUntil: "networkidle" });
  await flip(calm.page);
  const m = await calm.page.evaluate(() => ({
    scan: getComputedStyle(document.querySelector(".gl-px-scan")).animationName,
    badge: getComputedStyle(document.querySelector(".gl-px-badge")).animationName,
    view: getComputedStyle(document.querySelector(".gl-enter")).animationName,
  }));
  ok("no scanline flicker, no blink, no wipe", m.scan === "none" && m.badge === "none" && m.view === "none",
    JSON.stringify(m));
  await calm.ctx.close();
}

// --------------------------------------------------- the smallest phone
console.log("\n===== the header at 320");
{
  const small = await open({ width: 320, height: 800 });
  await small.page.goto(`${BASE}/lineup`, { waitUntil: "networkidle" });
  await flip(small.page);
  const head = await small.page.evaluate(() => {
    const nav = document.querySelector(".gl-nav");
    const last = nav?.querySelector(".gl-navend")?.lastElementChild?.getBoundingClientRect();
    const badge = document.querySelector(".gl-px-badge")?.getBoundingClientRect();
    return {
      width: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
      last: last ? Math.round(last.right) : null,
      badge: badge ? Math.round(badge.right) : null,
    };
  });
  ok(`the page does not run off the side (${head.scroll}px)`, head.scroll <= head.width);
  ok(`the avatar is reachable (ends at ${head.last})`, (head.last ?? 1e9) <= head.width);
  ok(`the badge is on screen (ends at ${head.badge})`, head.badge !== null && head.badge <= head.width);
  if (SHOTS) await small.page.locator(".gl-nav").screenshot({ path: `${SHOTS}/16bit-header-320.png` });
  await small.ctx.close();
}

// ------------------------------------------------------ and off again
console.log("\n===== off again");
{
  await page.goto(`${BASE}/lineup`, { waitUntil: "networkidle" });
  await flip(page); // the same switch, pressed again
  const m = await page.evaluate(() => ({
    retro: document.documentElement.dataset.retro ?? "",
    scan: document.querySelectorAll(".gl-px-scan").length,
    filtered: [...document.querySelectorAll("img")].filter((i) => getComputedStyle(i).filter.includes("px16")).length,
    bg: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
  }));
  ok("the skin comes off", m.retro === "" && m.scan === 0, JSON.stringify(m));
  ok("no image is filtered", m.filtered === 0);
  ok("and the palette is modern", m.bg !== "#0b1440", m.bg);
}

await ctx.close();
await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
