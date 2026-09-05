/**
 * Does the page still answer to being pulled down?
 *
 * A gesture is the one part of this app that no other check can see. The
 * layout audit measures a page at rest; the console check listens while it
 * loads. Neither of them can put a finger on the screen, so the four rules
 * that keep pull-to-refresh from fighting the page — arm only at the top,
 * commit only past the threshold, never on a sideways swipe, never mid-scroll
 * — could all break at once and every other check would stay green.
 *
 * Real touch input, through the browser's own input pipeline rather than
 * synthesised TouchEvents, because the gesture calls preventDefault and a
 * hand-made event is not cancelable in the same way.
 *
 *   ./scripts/audit-mobile.sh --pull
 */
import { chromium } from "playwright";
import { routes } from "./fixture.mjs";
import { sessionCookie } from "./session.mjs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3123";
/** Must match THRESHOLD in src/components/PullToRefresh.tsx. */
const THRESHOLD = 64;

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
);
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
await ctx.addCookies([sessionCookie()]);

const page = await ctx.newPage();
let calls = 0;
page.on("request", (r) => {
  if (r.url().includes("/api/")) calls++;
});
routes(page);

const cdp = await ctx.newCDPSession(page);
const touch = (type, x, y) =>
  cdp.send("Input.dispatchTouchEvent", {
    type,
    touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }],
  });

/** Where the badge is and how far round its arc has gone. */
const badge = () =>
  page.evaluate(() => {
    const el = document.querySelector('[aria-live="polite"] > div');
    if (!el) return null;
    const arc = el.querySelectorAll("svg circle")[1];
    const dash = Number(arc?.getAttribute("stroke-dasharray") ?? 0);
    const offset = Number(arc?.getAttribute("stroke-dashoffset") ?? 0);
    return {
      y: new DOMMatrixReadOnly(getComputedStyle(el).transform).m42,
      opacity: Number(getComputedStyle(el).opacity),
      round: dash ? 1 - offset / dash : 0,
      spinning: (el.querySelector("svg")?.getAttribute("class") ?? "").includes("gl-pull-busy"),
    };
  });

/** One finger, from just under the top bar, in ten steps. */
const drag = async (dx, dy) => {
  await touch("touchStart", 195, 120);
  for (let i = 1; i <= 10; i++) {
    await touch("touchMove", 195 + (dx * i) / 10, 120 + (dy * i) / 10);
    await page.waitForTimeout(16);
  }
};

const failures = [];
const check = (ok, said) => {
  console.log(`${ok ? "·" : "✗"} ${said}`);
  if (!ok) failures.push(said);
};

await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2500);

const rest = await badge();
check(rest !== null, "the indicator is on the page");
check(rest?.opacity === 0, "it is invisible until something is pulled");

// A pull past the threshold refreshes, and the arc closes on the way.
await drag(0, 180);
const pulled = await badge();
check(pulled.y > THRESHOLD, `it follows the finger down (${Math.round(pulled.y)}px)`);
check(pulled.y < 180, "with resistance — it moves less far than the finger did");
check(pulled.round > 0.99, "the arc is closed at the commit point");

calls = 0;
await touch("touchEnd", 0, 0);
await page.waitForTimeout(150);
check((await badge()).spinning, "releasing past the threshold sets it turning");
await page.waitForTimeout(1200);
check((await badge()).opacity === 0, "and it goes away when the boards have answered");
check(calls > 0, `the boards were actually asked again (${calls} calls)`);

// Short of the threshold, nothing happens.
await page.waitForTimeout(300);
calls = 0;
await drag(0, 40);
const short = await badge();
check(short.round < 0.9, "a short pull leaves the arc open");
await touch("touchEnd", 0, 0);
await page.waitForTimeout(700);
check(calls === 0, "and asks the server nothing");

// A sideways swipe belongs to whatever is under it.
calls = 0;
await drag(-160, 10);
check((await badge()).opacity === 0, "a sideways swipe never engages it");
await touch("touchEnd", 0, 0);
await page.waitForTimeout(500);
check(calls === 0, "and asks the server nothing");

// Halfway down a page, a downward drag is a scroll.
await page.evaluate(() => window.scrollTo(0, 400));
await page.waitForTimeout(200);
calls = 0;
await drag(0, 180);
check((await badge()).opacity === 0, "it does not arm below the top of the page");
await touch("touchEnd", 0, 0);
await page.waitForTimeout(700);
check(calls === 0, "and asks the server nothing");

await browser.close();

console.log();
if (failures.length) {
  console.log(`${failures.length} of the gesture's rules broken`);
  process.exit(1);
}
console.log("the pull gesture holds");
