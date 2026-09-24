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
      musicButton: Boolean(document.querySelector(".gl-music")),
      // It used to be fixed to the bottom-left corner, which put a forty-pixel
      // square on top of a roster row. Nothing in this app covers content.
      musicFixed: (() => {
        const b = document.querySelector(".gl-music");
        return b ? getComputedStyle(b).position === "fixed" : null;
      })(),
      // And it is in the header, with the other two standing controls, rather
      // than merely somewhere that happens not to be fixed.
      musicInNav: (() => {
        const b = document.querySelector(".gl-music");
        return b ? Boolean(b.closest(".gl-nav")) : null;
      })(),
      musicPlaying: (() => {
        const a = document.querySelector("audio[src*='16bit-theme']");
        return a ? !a.paused : null;
      })(),
      musicPreload: document.querySelector("audio[src*='16bit-theme']")?.getAttribute("preload") ?? "",
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

  // The music. Silent by default is the whole contract: a page that makes a
  // noise on arrival is the thing everybody hates, and no browser would allow
  // it before an interaction anyway.
  ok("there is a mute switch", m.musicButton);
  ok("and it covers nothing", m.musicFixed === false, `position ${m.musicFixed}`);
  ok("because it lives in the header", m.musicInNav === true, String(m.musicInNav));
  ok("and it starts silent", m.musicPlaying === false, String(m.musicPlaying));
  ok("the track is not fetched until it is wanted", m.musicPreload === "none", m.musicPreload);

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
  const noise = await dark.evaluate(() => ({
    audio: document.querySelectorAll("audio[src*='16bit-theme']").length,
    button: document.querySelectorAll(".gl-music").length,
  }));
  // 1.3MB of Genesis soundtrack that nobody on the dark theme asked for.
  ok("and never fetches the music", noise.audio === 0 && noise.button === 0,
    JSON.stringify(noise));
  await plain.close();
}

// ------------------------------------------------------------- the music
// A switch that exists is not a switch that works. A real click is a user
// gesture, which is the thing the browser was holding out for.
console.log("\n===== the mute switch");
{
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);

  await page.locator(".gl-music").click();
  await page.waitForTimeout(900);

  const playing = await page.evaluate(() => {
    const a = document.querySelector("audio[src*='16bit-theme']");
    return a ? { paused: a.paused, loop: a.loop, t: a.currentTime } : null;
  });
  ok(`pressing it starts the track (${JSON.stringify(playing)})`, playing?.paused === false);
  ok("and it loops", playing?.loop === true);

  await page.locator(".gl-music").click();
  await page.waitForTimeout(400);
  const after = await page.evaluate(() =>
    document.querySelector("audio[src*='16bit-theme']")?.paused);
  ok("pressing it again stops it", after === true);

  // And the choice outlives the page, like every other preference here.
  await page.locator(".gl-music").click();
  await page.waitForTimeout(300);
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  const remembered = await page.evaluate(() => localStorage.getItem("gl.retro.music"));
  ok("and is remembered", remembered === "on", String(remembered));
  await page.evaluate(() => localStorage.setItem("gl.retro.music", "off"));
}

// -------------------------------------------------- the header at 320px
// The header now carries a third control, and it carries it only in this
// theme — which means the width audit, which loads the dark theme, never sees
// it. On the smallest phone the bar is already a wordmark and two round
// controls in three hundred and twenty pixels, and it scrolls sideways under a
// mask rather than overflowing: an avatar pushed past the edge does not
// register as overflow anywhere, it just quietly stops being reachable.
//
// So what is asserted is the right edge of the last control, not the bar's
// scrollWidth. The two disagree by exactly the bar's trailing padding — which
// is twenty-six pixels of nothing, and measuring it was how the first version
// of this check reported fifteen pixels of trouble that did not exist.
console.log("\n===== the header on the smallest phone");
{
  const small = await browser.newContext({ viewport: { width: 320, height: 800 }, isMobile: true, hasTouch: true });
  await small.addCookies([sessionCookie()]);
  await small.addInitScript(() => {
    try { localStorage.setItem("pylon:theme", "16bit"); } catch { /* storage off */ }
  });
  const tiny = await small.newPage();
  tiny.setDefaultNavigationTimeout(120_000);
  await routes(tiny);
  await tiny.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await tiny.waitForTimeout(600);

  const head = await tiny.evaluate(() => {
    const nav = document.querySelector(".gl-nav");
    const end = nav?.querySelector(".gl-navend");
    const last = end?.lastElementChild;
    const music = document.querySelector(".gl-music");
    const box = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) };
    };
    return {
      width: window.innerWidth,
      scroll: document.documentElement.scrollWidth,
      music: box(music),
      last: box(last),
      // Printed rather than asserted: when the edge assertion fails this says
      // which part of the bar took the room.
      parts: [...(end?.children ?? [])].map((el) => {
        const r = el.getBoundingClientRect();
        return `${el.className || el.tagName.toLowerCase()} ${Math.round(r.width)}`;
      }).join(" | "),
    };
  });

  console.log(`    (header end: ${head.parts})`);
  ok(`the page still does not run off the side (${head.scroll}px)`, head.scroll <= head.width);
  ok("the switch is there at 320 too", Boolean(head.music), JSON.stringify(head.music));
  ok(`and is still a tap target (${head.music?.w}x${head.music?.h})`,
    (head.music?.w ?? 0) >= 32 && (head.music?.h ?? 0) >= 32);
  // A square, and it has to stay one. The phone's min-width and min-height
  // rules grow small controls by different amounts — thirty-four by forty —
  // which is a rectangle standing between two circles.
  ok(`and it is square (${head.music?.w}x${head.music?.h})`, head.music?.w === head.music?.h);
  // The one a third control actually threatens: the avatar is the last thing
  // in the bar, so it is the first thing a crowded header pushes off the edge.
  ok(`the last control is reachable without dragging (ends at ${head.last?.right} of ${head.width})`,
    (head.last?.right ?? 1e9) <= head.width);

  if (SHOTS) {
    const nav = tiny.locator(".gl-nav");
    if (await nav.count()) await nav.screenshot({ path: `${SHOTS}/16bit-header-320.png`, scale: "device" });
  }
  await small.close();
}

// ---------------------------------------------------------- the tab sound
// The bottom bar makes a noise in this theme and in no other. Nothing about
// that is visible, so it is checked the only way it can be: by recording every
// play() the page attempts and pressing a tab.
console.log("\n===== the tab sound");
{
  const record = () => {
    window.__plays = [];
    const orig = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function play(...args) {
      window.__plays.push(this.getAttribute("src") ?? this.src ?? "");
      return orig.apply(this, args);
    };
  };

  const tapATab = async (target) => {
    // The League tab, which is a tab nobody starts on, so the press is a real
    // navigation rather than a no-op on the current page.
    await target.locator('.gl-tabbar a[href="/the-league"]').click();
    await target.waitForTimeout(500);
    return target.evaluate(() => window.__plays ?? []);
  };

  const retroCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await retroCtx.addCookies([sessionCookie()]);
  await retroCtx.addInitScript(() => {
    try { localStorage.setItem("pylon:theme", "16bit"); localStorage.setItem("gl.retro.music", "off"); } catch { /* storage off */ }
  });
  await retroCtx.addInitScript(record);
  const retro = await retroCtx.newPage();
  retro.setDefaultNavigationTimeout(120_000);
  await routes(retro);

  // The file itself has to be there. A 404 is a silent tab in production and
  // nothing here would otherwise notice.
  const head = await retro.request.get(`${BASE}/assets/16bit-tab.mp3`);
  ok(`the sound is served (${head.status()})`, head.ok());

  await retro.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await retro.waitForTimeout(600);

  const before = await retro.evaluate(() => (window.__plays ?? []).length);
  ok("nothing plays on arrival", before === 0, String(before));

  const plays = await tapATab(retro);
  ok(`pressing a tab plays it (${JSON.stringify(plays)})`,
    plays.some((src) => src.includes("16bit-tab")));
  // The theme's music is off; the only thing that should have made a sound is
  // the press. A tab that started the soundtrack would be a different bug.
  ok("and nothing else", plays.every((src) => src.includes("16bit-tab")), JSON.stringify(plays));
  await retroCtx.close();

  const plainCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await plainCtx.addCookies([sessionCookie()]);
  await plainCtx.addInitScript(() => {
    try { localStorage.setItem("pylon:theme", "dark"); } catch { /* storage off */ }
  });
  await plainCtx.addInitScript(record);
  const quiet = await plainCtx.newPage();
  quiet.setDefaultNavigationTimeout(120_000);
  await routes(quiet);
  await quiet.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await quiet.waitForTimeout(600);

  const silent = await tapATab(quiet);
  ok("the dark theme presses silently", silent.length === 0, JSON.stringify(silent));
  await plainCtx.close();
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
