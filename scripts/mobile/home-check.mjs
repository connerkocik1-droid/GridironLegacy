/**
 * Does the home page page through the season, and is any of it real?
 *
 * The redesign's centrepiece is a hero that steps across the next five weeks.
 * A pager that looks right and shows the same week five times is the failure
 * worth catching, so every assertion here is about the numbers changing.
 */
import { chromium } from "playwright";
import { routes } from "./fixture.mjs";
import { sessionCookie } from "./session.mjs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3123";
let failed = 0;
const ok = (label, got) => { console.log(`${got ? "PASS" : "FAIL"}  ${label}`); if (!got) failed++; };

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 402, height: 900 }, isMobile: true, hasTouch: true });
await ctx.addCookies([sessionCookie()]);
const page = await ctx.newPage();
await routes(page);
await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
await page.waitForTimeout(1000);

const body = () => page.locator("body").innerText();

console.log("--- the countdown ---");
{
  // By its label rather than out of the page text: the clock sits in a span of
  // its own, so innerText breaks the line between "KICKOFF IN 1D" and the
  // digits — and a regex that stops at the newline reads the one part that
  // never changes and calls a working clock frozen.
  const clock = page.getByLabel("Time until kickoff");
  const first = await clock.innerText();
  ok("it says how long until kickoff", /KICKOFF IN/i.test(first));
  ok("with a day count and a clock", /\d+D\s*\n?\s*\d{2}:\d{2}:\d{2}/.test(first));

  // It has to tick, or it is a picture of a countdown.
  await page.waitForTimeout(1600);
  ok(`and it is counting, not frozen (${first.split("\n").pop()} → ${(await clock.innerText()).split("\n").pop()})`,
    (await clock.innerText()) !== first);
}

console.log("\n--- the matchup hero ---");
{
  const t = await body();
  ok("it names the week", /WEEK \d/.test(t));
  ok("both franchises", /Steel Cartel/.test(t) && /Bay Area/.test(t));
  ok("what each side projects", /118\.4/.test(t) && /111\.2/.test(t));
  ok("the odds", /WIN PROBABILITY/i.test(t));
  ok("the opponent's record", /OPP RECORD/i.test(t));
  ok("the season's points gap", /PF GAP/i.test(t));
  ok("and a way into the full head to head",
    (await page.locator('a[href^="/lineup"]').count()) > 0);
}

console.log("\n--- and it opens the rest of the week ---");
{
  // It used to page across the reader's own next five fixtures, which is five
  // taps to read five projections drawn before a ball was kicked. What a
  // manager wants from this card is the eleven games they are not in.
  ok("the five-week pager is gone",
    (await page.getByRole("button", { name: "Next week" }).count()) === 0);

  const whole = page.locator('a[href^="/matchups?view=league"]');
  ok("and pressing through leads to every game in the week",
    (await whole.count()) > 0);
  ok("named by the week it will open",
    /EVERY GAME IN WEEK \d/.test(await body()));
  ok("with the week in the address, not left to the page to guess",
    ((await whole.first().getAttribute("href")) ?? "").includes("week="));
  ok("and the reader's own game is still one press away",
    (await page.locator('a[href^="/lineup"]').count()) > 0);
}

console.log("\n--- the power rank ---");
{
  const t = await body();
  ok("it ranks the league", /POWER RANK/i.test(t));
  ok("with each roster's average age", /avg age \d\d\.\d/.test(t));
  ok("and points for", /\d+\.\d PF/.test(t));
  ok("somebody has gone up", /▲/.test(t));
  ok("somebody has gone down", /▼/.test(t));
  ok("and a team that has not moved says so", /—/.test(t));
  ok("your own row is marked", /· YOU/.test(t));

  const before = await page.locator('a[href^="/team/"], a[href="/lineup"]').count();
  await page.getByRole("button", { name: /ALL \d+ TEAMS/ }).click();
  await page.waitForTimeout(300);
  const after = await page.locator('a[href^="/team/"], a[href="/lineup"]').count();
  ok(`it opens out to the whole league (${before} then ${after})`, after > before);
  ok("and every row leads to that team",
    (await page.locator('a[href^="/team/"]').count()) >= 5);
}

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
