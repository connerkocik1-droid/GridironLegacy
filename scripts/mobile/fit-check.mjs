/**
 * How many screens does a page take, and does the matchup still take one?
 *
 * The layout audit measures widths: nothing runs off the side, nothing is too
 * small to press, nothing is squeezed until it wraps a word per line. It says
 * nothing at all about height, and height is what a manager actually pays —
 * /lineup once opened at three and a half screens with the score two screens
 * down, because it drew the whole roster above the head-to-head and then gave
 * every player a stat line that wrapped to three rows in a half-phone column.
 *
 * So this is the other axis. It reports every page it loads in screens, and
 * it fails on two:
 *
 *   - the matchup must fit one screen. It is eleven rows and a scoreline, it
 *     is the page the tab bar's own tab points at, and its whole job is to be
 *     read at a glance during a game.
 *   - My Team must stay under two and a quarter. Fifteen men at sixty-odd
 *     pixels cannot fit one screen and should not pretend to; the ceiling is
 *     there to catch the next thing that quietly adds a line to every row.
 *
 * Measured on one phone rather than the audit's two widths, because a budget
 * in screens needs a screen: 402x874 is an iPhone 16 in Safari with its bars
 * showing. A smaller phone scrolls, and that is fine — this is a check on the
 * layout's appetite, not a promise about every handset.
 */
import { chromium } from "playwright";
import { routes } from "./fixture.mjs";
import { sessionCookie } from "./session.mjs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3123";

/**
 * [label, path, what says it has loaded, how many screens it may take]
 *
 * A null budget is reported and not failed. Most of these pages are lists
 * and a list is as long as the league made it — a ceiling on the standings
 * would be a ceiling on the number of franchises. They are measured anyway,
 * because the number is the only way to notice a page that has quietly
 * doubled, and because the two that do carry budgets got them by being
 * measured first.
 */
const PAGES = [
  ["matchup", "/lineup", /PROJ|PTS|SCORED|WIN PROBABILITY/, 1.0],
  ["roster", "/my-team", /PPG|NOT YET RANKED/, 2.25],
  ["home", "/", /WEEK|MATCHUP|STANDINGS/, null],
  ["league", "/the-league", /STANDINGS|POWER|W-L/, null],
  ["moves", "/moves", /WAIVER|FREE AGENT|ADD/, null],
  ["week", "/matchups", /WEEK|VS/, null],
  ["profile", "/player/Jayden%20Daniels", /PROJ|SEASON|QB/, null],
  ["games", "/games", /WEEK|FINAL|ET/, null],
];

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, isMobile: true, hasTouch: true });
await ctx.addCookies([sessionCookie()]);
const page = await ctx.newPage();
await routes(page);

let failed = 0;

for (const [label, url, waitFor, budget] of PAGES) {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  await page
    .waitForFunction((src) => new RegExp(src).test(document.body.innerText), waitFor.source, { timeout: 20000 })
    .catch(() => {});
  // The live numbers count up on arrival and the enter animation is 200ms.
  await page.waitForTimeout(800);

  const m = await page.evaluate((deep) => {
    // Every block that takes real vertical space, so a failure says which
    // one to go and look at rather than only that the page is too tall.
    const blocks = [];
    const walk = (el, depth) => {
      if (depth > deep) return;
      for (const kid of el.children) {
        const h = Math.round(kid.getBoundingClientRect().height);
        if (h >= 40) {
          blocks.push({ depth, h, text: (kid.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 44) });
          walk(kid, depth + 1);
        }
      }
    };
    walk(document.body, 0);
    return { page: Math.round(document.documentElement.scrollHeight), screen: window.innerHeight, blocks };
  }, Number(process.env.FIT_DEPTH ?? 3));

  const screens = m.page / m.screen;
  // A pixel of slack, because scrollHeight rounds and a border can land on a
  // half. A page that is one pixel over is not a page anybody scrolls.
  const pass = budget == null || m.page <= Math.round(budget * m.screen) + 1;
  if (!pass) failed++;

  console.log(
    `${budget == null ? "····" : pass ? "PASS" : "FAIL"}  ` +
    `${label.padEnd(8)} ${url.padEnd(24)} ${String(m.page).padStart(5)}px = ` +
    `${screens.toFixed(2)} screens` + (budget == null ? "" : `, budget ${budget.toFixed(2)}`),
  );
  if (!pass || process.env.FIT_VERBOSE) {
    for (const b of m.blocks) console.log(`${"  ".repeat(b.depth + 1)}${String(b.h).padStart(5)}px  ${b.text}`);
  }
}

/*
 * And the thing the matchup's budget is bought with.
 *
 * Eleven rows fit one screen because the stat lines are off by default. That
 * is only acceptable while the switch works: a reader who wants to know how
 * the eighteen points happened has to be able to get the line back, and get
 * it back next week without asking again. If the switch ever silently stops
 * working, the page has not become tidier — it has lost the stat lines.
 */
const ok = (label, got) => { console.log(`${got ? "PASS" : "FAIL"}  ${label}`); if (!got) failed++; };

await page.goto(`${BASE}/lineup`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
const lineShowing = () => page.locator(".gl-mcell-line").count();

ok("stat lines start hidden", (await lineShowing()) === 0);

await page.getByRole("button", { name: "STAT LINES" }).click();
await page.waitForTimeout(150);
ok("the switch brings them back", (await lineShowing()) > 0);

await page.reload({ waitUntil: "networkidle" });
await page.waitForTimeout(600);
ok("and they are still on next visit", (await lineShowing()) > 0);

await page.getByRole("button", { name: "STAT LINES" }).click();
await page.waitForTimeout(150);
const tidyAgain = await page.evaluate(() => document.documentElement.scrollHeight);
ok("the switch puts them away again", (await lineShowing()) === 0);
ok(`and the page is back inside one screen (${tidyAgain}px)`, tidyAgain <= 875);

await browser.close();
console.log(failed ? `\n${failed} check(s) failed` : "\nevery page inside its budget");
process.exit(failed ? 1 : 0);
