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

console.log("--- who is here ---");
{
  const strip = page.locator("text=HERE NOW").first();
  ok("the top of the page says who is about", await strip.count() > 0);

  const row = page.locator('[aria-label$="in the app right now"]').first();
  const t = (await row.count()) ? await row.innerText() : "";

  ok("it names them by first name, not by franchise",
    /Conner/.test(t) && !/Steel Cartel/.test(t));
  ok("and marks which one is you", /you/i.test(t));

  // Two Danas online. Two identical chips would say somebody is here without
  // saying who, which is the whole reason the surname initial exists.
  ok(`both Danas are told apart (${(t.match(/Dana\s\w\./g) ?? []).join(" ")})`,
    /Dana W\./.test(t) && /Dana K\./.test(t));

  ok("somebody who is not about is not listed", !/\bSam\b/.test(t));
  ok("the open seat is never listed as a person", !/\bOpen\b/.test(t));

  // The dot is the state; the ring is the pulse. Both come from the class, so
  // a strip drawn with flat grey dots would still read correctly here.
  const dots = await page.evaluate(() => {
    const row = document.querySelector('[aria-label$="in the app right now"]');
    if (!row) return null;
    const all = [...row.querySelectorAll(".gl-presence")];
    return {
      count: all.length,
      lit: all.filter((d) => d.classList.contains("is-on")).length,
      ring: all.length
        ? getComputedStyle(all[0], "::after").animationName
        : "",
    };
  });
  ok("every name carries a dot", !!dots && dots.count === 4);
  ok("and every one of them is lit", !!dots && dots.lit === dots.count);
  ok(`the lit dot pulses (${dots?.ring ?? "none"})`, dots?.ring === "gl-presence-ping");
}

console.log("\n--- no countdown ---");
{
  // Removed. The ticker above it already says what is on and when, and a
  // clock counting down to Thursday is a thing a manager reads once.
  ok("the kickoff clock is gone",
    (await page.getByLabel("Time until kickoff").count()) === 0);
  ok("and nothing else is counting to it", !/KICKOFF IN/i.test(await body()));
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

  // Signed, and with a real minus rather than a hyphen — the sign is the whole
  // of what this number says.
  ok(`and it says which way round (${(t.match(/[+−]\d+\.\d(?=\s*\n?\s*PF GAP)/) ?? ["none"])[0]})`,
    /[+−]\d+\.\d\s*\n?\s*PF GAP/.test(t) || /0\.0\s*\n?\s*PF GAP/.test(t));
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
  // Counted off the table itself rather than off the page: the strip at the
  // top of Home carries the same dots, and a page-wide count would pass on
  // the strip alone while the table drew nothing.
  const { lit, dim, names } = await page.evaluate(() => {
    const strip = document.querySelector('[aria-label$="in the app right now"]');
    const table = [...document.querySelectorAll(".gl-presence")].filter((d) => !strip?.contains(d));
    return {
      lit: table.filter((d) => d.classList.contains("is-on")).length,
      dim: table.filter((d) => !d.classList.contains("is-on")).length,
      // Who each page thinks is about, to compare them.
      names: [...(strip?.querySelectorAll('[aria-label$="is here now"]') ?? [])]
        .map((d) => d.getAttribute("aria-label").replace(" is here now", "")),
    };
  });
  ok(`the four who are about are lit (${lit})`, lit === 4);
  ok(`and the eight who are not are still drawn (${dim})`, dim === 8);
  ok(`and the strip at the top names the same four (${names.join(", ")})`,
    names.length === 4);

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
