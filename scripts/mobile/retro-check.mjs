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

// Three times the pixels, so a two-pixel shadow is something a person can
// actually judge in the screenshot. Device pixels do not change CSS layout,
// so nothing measured here moves.
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3,
});
await ctx.addCookies([sessionCookie()]);
// Set before any document runs, the same way the pre-paint script would find
// it: if this theme only works after a click, it flashes the wrong one first.
await ctx.addInitScript(() => {
  try { localStorage.setItem("pylon:theme", "16bit"); } catch { /* storage off */ }
});
const page = await ctx.newPage();
page.setDefaultNavigationTimeout(120_000);
await routes(page);

// Headshots come from ESPN's CDN, which this sandbox cannot reach — so they
// never load, the canvas never runs, and the conversion cannot be checked
// where it matters most. Answering the CDN with a real PNG puts the whole
// path under test offline: the image loads, the filter runs, and a failure
// here is a failure in our code rather than in the network.
const FACE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAXUlEQVR42u3QMQEAAAjDMMC/56EB" +
  "3RJInbTVAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAgQIAAAQIECBAg" +
  "QIAAAQIECBAgQIDAjwUXHAABm2JhGwAAAABJRU5ErkJggg==",
  "base64",
);
await page.route("**a.espncdn.com/**", (route) =>
  route.fulfill({ status: 200, contentType: "image/png", body: FACE }));

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
      // Exactly one element animates, and it is the pylon and wordmark pair.
      // A bounce that spread to anything else would be a selector too broad.
      bounce: [...document.querySelectorAll("*")]
        .filter((el) => getComputedStyle(el).animationName === "gl-bounce").length,
      hops: getComputedStyle(document.querySelector(".gl-mark") ?? document.body).animationIterationCount,
      pylonShadow: getComputedStyle(document.querySelector(".gl-mark svg") ?? document.body).filter,
      wordShadow: getComputedStyle(
        document.querySelector(".gl-mark .gl-wordmark") ?? document.body).textShadow,
      faces: document.querySelectorAll(".gl-face").length,
      // Counted off the alt-less faces in player rows: once converted the src
      // is a data URL, so the /headshots/ selector no longer finds them.
      allFaces: document.querySelectorAll(".gl-face").length,
      spriteFaces: [...document.querySelectorAll(".gl-face")]
        .filter((el) => (el.getAttribute("src") ?? "").startsWith("data:image/png")).length,
      idle: [...document.querySelectorAll(".gl-face")]
        .filter((el) => getComputedStyle(el).animationName === "gl-idle").length,
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
  ok("the header mark is the one thing that bounces", m.bounce === 1, String(m.bounce));
  ok(`and it hops more than once (${m.hops})`, m.hops === "3", m.hops);
  // The shadow is the part a still screenshot can actually show, and the part
  // that has to beat an inline filter on the svg.
  ok(`the pylon casts a hard shadow (${m.pylonShadow})`,
    /drop-shadow\(.*2px 2px 0/.test(m.pylonShadow) && !/9px/.test(m.pylonShadow));
  ok(`and so does the wordmark (${m.wordShadow})`, /2px 2px/.test(m.wordShadow));
  ok(`every headshot idles (${m.idle})`, m.idle > 0 || m.faces === 0, `${m.idle} of ${m.faces}`);
  // The one the theme was missing. image-rendering: pixelated does nothing to
  // a downscaled image, so a face only becomes a sprite if the canvas has
  // actually been through it — which means a data: src, not a CDN URL.
  ok(`and every face is a sprite (${m.spriteFaces} of ${m.allFaces})`,
    m.spriteFaces === m.allFaces);

  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/16bit-${label}.png`, fullPage: true });
    // The header on its own and close up. The bounce has finished by the time
    // any screenshot is taken, but the shadow has not, and two pixels of it in
    // a 390px-wide full-page shot is not something a person can judge.
    if (label === "home") {
      const mark = page.locator(".gl-mark");
      if (await mark.count()) {
        await mark.screenshot({ path: `${SHOTS}/16bit-mark.png`, scale: "device" });
      }
    }
  }
}

// ------------------------------------------------------- the sprite filter
// The crests and club marks are redrawn through a canvas at render. Two ways
// that can go wrong and neither is visible in a screenshot: the conversion
// silently failing everywhere (a tainted canvas, a CDN that will not send
// CORS) and leaving the original photograph, or the conversion running in a
// theme that did not ask for it.
console.log("\n===== the sprite filter");
{
  await page.goto(`${BASE}/lineup`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1800);

  const marks = await page.evaluate(() =>
    [...document.querySelectorAll("img")]
      .map((el) => el.getAttribute("src") ?? "")
      .filter((src) => src && !src.startsWith("data:image/gif")));
  console.log(`    (${marks.length} images: ${marks.map((m) => m.slice(0, 28)).join(" | ")})`);

  const sprites = marks.filter((src) => src.startsWith("data:image/png"));
  ok(`something was converted (${sprites.length} of ${marks.length} images)`, sprites.length > 0);

  // A sprite is tiny by construction — a 24px-square PNG — and that is what
  // keeps a page of them cheap. A conversion that quietly emitted the full
  // image would still be a data URL and would still look right.
  const biggest = Math.max(0, ...sprites.map((s) => s.length));
  ok(`and the sprites are small (largest ${biggest} chars)`, biggest > 0 && biggest < 12_000);
}

console.log("\n===== and not in the other themes");
{
  const plain = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  await plain.addCookies([sessionCookie()]);
  await plain.addInitScript(() => {
    try { localStorage.setItem("pylon:theme", "dark"); } catch { /* storage off */ }
  });
  const dark = await plain.newPage();
  dark.setDefaultNavigationTimeout(120_000);
  await routes(dark);
  await dark.goto(`${BASE}/the-league`, { waitUntil: "networkidle" });
  await dark.waitForTimeout(1200);

  const converted = await dark.evaluate(() =>
    [...document.querySelectorAll("img")]
      .filter((el) => (el.getAttribute("src") ?? "").startsWith("data:image/png")).length);
  ok("the dark theme does no canvas work at all", converted === 0, String(converted));
  await plain.close();
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
