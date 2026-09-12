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

  // Presence here as well as on the League tab, and agreeing with it: two
  // pages with two opinions about who is about is worse than neither having
  // one.
  await page.getByRole("button", { name: /ALL \d+ TEAMS/ }).click();
  await page.waitForTimeout(400);
  const lit = await page.locator(".gl-presence.is-on").count();
  const dim = await page.locator(".gl-presence:not(.is-on)").count();
  ok(`the four who are about are lit (${lit})`, lit === 4);
  ok(`and the eight who are not are still drawn (${dim})`, dim === 8);

  // Closed again, so the count below measures the opening rather than a
  // list that was already open from the check above.
  await page.getByRole("button", { name: /TOP \d+|ALL \d+ TEAMS/ }).click();
  await page.waitForTimeout(300);
  const before = await page.locator('a[href^="/team/"], a[href="/lineup"]').count();
  await page.getByRole("button", { name: /ALL \d+ TEAMS/ }).click();
  await page.waitForTimeout(300);
  const after = await page.locator('a[href^="/team/"], a[href="/lineup"]').count();
  ok(`it opens out to the whole league (${before} then ${after})`, after > before);
  ok("and every row leads to that team",
    (await page.locator('a[href^="/team/"]').count()) >= 5);
}

console.log("\n--- the ballots ---");
{
  const t = await body();
  ok("somebody else's trade is on the front page", /LEAGUE VOTE/.test(t));
  ok("naming both franchises", /Kim's Very Long Franchise Name/.test(t) && /Gold Coast Gladiators/.test(t));
  ok("saying what leaves each of them", /Jahmyr Gibbs/.test(t) && /Brock Bowers/.test(t));
  ok("counting picks rather than naming them", /1 draft pick\b/.test(t) && /2 draft picks/.test(t));
  ok("and an empty half says so rather than going blank", /Nothing/.test(t));

  // The count is the difference between an unpopular trade and an unnoticed
  // one, and it is a number nobody can read off a progress bar.
  ok("the count is out of the bar it has to reach", /3\/4 veto/.test(t) && /1\/4 approve/.test(t));
  ok("with how long is left", /closes in 14h/.test(t));
  ok("in hours or minutes, whichever reads", /closes in 40m/.test(t));

  const votes = page.locator('div:has-text("LEAGUE VOTE")');
  ok("both open ballots are there", (await page.getByRole("button", { name: "VETO" }).count()) === 2);

  // Nothing about a vote reaches a phone if the buttons are 24px tall.
  const box = await page.getByRole("button", { name: "APPROVE" }).first().boundingBox();
  ok(`a thumb can hit approve (${Math.round(box?.height ?? 0)}px)`, (box?.height ?? 0) >= 40);
  ok("and it does not run off the side", (box?.width ?? 0) + (box?.x ?? 0) <= 402);
  void votes;

  // The card has to leave when the vote is cast, or the manager cannot tell
  // whether it went through and votes again.
  await page.route("**/api/trades/b1/vote", (route) =>
    route.fulfill({ status: 200, contentType: "application/json",
      body: JSON.stringify({ ok: true, vote: "veto", settled: "declined" }) }));

  const before = await page.getByRole("button", { name: "VETO" }).count();
  await page.getByRole("button", { name: "VETO" }).first().click();
  await page.waitForFunction(
    (n) => document.querySelectorAll("button").length > 0 &&
      [...document.querySelectorAll("button")].filter((b) => b.textContent?.trim() === "VETO").length < n,
    before, { timeout: 8000 }).catch(() => {});
  ok(`the card leaves once you have voted (${before} then ${await page.getByRole("button", { name: "VETO" }).count()})`,
    (await page.getByRole("button", { name: "VETO" }).count()) < before);
}

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
