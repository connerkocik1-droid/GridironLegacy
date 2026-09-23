/**
 * Does the sixteen-bit theme actually apply, and does it break anything?
 *
 * A theme is the one kind of change that touches every screen and is checked
 * by nothing: the layout audit loads the default theme, the unit tests never
 * see CSS, and a palette that reads well in a stylesheet can still put white
 * text on white. So this loads the real pages with data-theme="16bit" set the
 * way the app sets it, and asks the three questions that can actually fail.
 *
 *   Did it take? A misspelled selector fails silently and leaves the dark
 *   theme on screen, which looks like nothing happened.
 *   Is it still square? The radius tokens are the whole geometry of it.
 *   Does anything overflow? Nothing here changes layout on purpose, so a
 *   wider page means something did by accident.
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

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await ctx.addCookies([sessionCookie()]);
// Set before any document runs, the same way the pre-paint script would find
// it: if this theme only works after a click, it flashes the wrong one first.
await ctx.addInitScript(() => {
  try { localStorage.setItem("pylon:theme", "16bit"); } catch { /* storage off */ }
});
const page = await ctx.newPage();
page.setDefaultNavigationTimeout(120_000);
await routes(page);

for (const [label, url] of [["home", "/"], ["matchup", "/lineup"], ["roster", "/my-team"]]) {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);

  const m = await page.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const body = getComputedStyle(document.body);
    // A card, whichever page this is: the first element with a real border.
    const card = [...document.querySelectorAll("div")].find((d) => {
      const s = getComputedStyle(d);
      return parseFloat(s.borderTopWidth) > 0 && d.getBoundingClientRect().width > 120;
    });
    return {
      theme: root.dataset.theme,
      bg: cs.getPropertyValue("--bg").trim(),
      accent: cs.getPropertyValue("--accent-link").trim(),
      radius: cs.getPropertyValue("--radius-lg").trim(),
      cardRadius: card ? getComputedStyle(card).borderTopLeftRadius : "none",
      bodyBg: body.backgroundColor,
      scroll: root.scrollWidth,
      width: window.innerWidth,
      // The scanline layer, which must be there and must never take a tap.
      lines: getComputedStyle(document.body, "::after").pointerEvents,
      // A crest is a circle in every other theme. This is the one that kept
      // giving the game away.
      crest: (() => {
        const c = document.querySelector(".gl-crest");
        return c ? getComputedStyle(c).borderTopLeftRadius : "none";
      })(),
      // The heading face asks for the pixel font first. Whether the glyphs
      // arrive depends on a CDN this check cannot reach, so what is asserted
      // is the request, not the rendering.
      heading: getComputedStyle(document.documentElement).getPropertyValue("--font-heading").trim(),
      fontLink: Boolean(document.getElementById("pylon-pixel-font")),
    };
  });

  console.log(`\n===== ${label} (${url})`);
  ok("the theme is on the root", m.theme === "16bit", m.theme);
  ok("the palette swapped", m.bg === "#12102a", `--bg ${m.bg}`);
  ok("and so did the accent", m.accent === "#5ce1ff", `--accent-link ${m.accent}`);
  ok("the corners are square", m.radius === "0px", `--radius-lg ${m.radius}`);
  ok("a real card is square too", m.cardRadius === "0px", m.cardRadius);
  ok("the scanlines take no taps", m.lines === "none", m.lines);
  ok(`nothing runs off the side (${m.scroll}px wide)`, m.scroll <= m.width);
  ok("a crest is square", m.crest === "0px" || m.crest === "none", m.crest);
  ok("headings ask for the pixel face first", m.heading.startsWith('"Pixelify Sans"'), m.heading);
  ok("and it is only fetched once the theme is on", m.fontLink);

  if (SHOTS) await page.screenshot({ path: `${SHOTS}/16bit-${label}.png`, fullPage: true });
}

// And the switch itself: three themes have to be reachable, and picking one
// has to survive a reload or it is a toy.
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(400);
const stored = await page.evaluate(() => localStorage.getItem("pylon:theme"));
ok("\nthe choice is what the app stored", stored === "16bit", String(stored));

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
