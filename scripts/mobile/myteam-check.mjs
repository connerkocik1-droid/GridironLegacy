/**
 * Does the Roster screen say what the roster is worth, and who is counting?
 *
 * The redesign put the roster into three groups: the best-ball lineup that is
 * counting now, the bench, and the reserve. A layout audit sees rows; it
 * cannot tell whether the lineup is the one the league fields, or whether a
 * total before kickoff is a projection or a nought. Those are checked here.
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { routes } from "./fixture.mjs";
import { sessionCookie } from "./session.mjs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3123";
const SHOTS = process.env.AUDIT_SHOTS ?? "";
let failed = 0;
const ok = (label, got) => { console.log(`${got ? "PASS" : "FAIL"}  ${label}`); if (!got) failed++; };

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const ctx = await browser.newContext({ viewport: { width: 402, height: 900 }, isMobile: true, hasTouch: true });
await ctx.addCookies([sessionCookie()]);
const page = await ctx.newPage();
await routes(page);

const body = () => page.locator("body").innerText();
const load = async (query = "") => {
  await page.goto(`${BASE}/my-team${query}`, { waitUntil: "networkidle" });
  // Waited for rather than slept on: a cold compile in dev is slower than any
  // fixed pause worth writing.
  await page
    .waitForFunction(() => /COUNTING NOW/.test(document.body.innerText), undefined, { timeout: 20000 })
    .catch(() => {});
};

await load();
if (SHOTS) {
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/my-team-roster.png`, fullPage: true });
}

console.log("--- the lineup ---");
{
  const t = await body();
  ok("the counting group is there", /COUNTING NOW/.test(t));
  ok("and says it is best ball", /pts · best ball|proj · best ball/.test(t));
  ok("the bench is its own group", /\bBENCH\b/.test(t));

  // The slot tiles, read off the rows rather than the page: "QB" is also a
  // position written beside every quarterback's name.
  const tiles = await page.evaluate(() =>
    [...document.querySelectorAll(".gl-row")].map((row) => row.firstElementChild?.textContent?.trim() ?? ""));
  const want = ["QB", "RB1", "RB2", "WR1", "WR2", "TE", "K", "D/ST"];
  const missing = want.filter((slot) => !tiles.includes(slot));
  ok(`every slot the league fields is filled (${missing.join(", ") || "all"})`, missing.length === 0);
  ok(`with two flexes (${tiles.filter((s) => s === "FLEX").length})`, tiles.filter((s) => s === "FLEX").length === 2);
  // A league fielding two backs must tile two, not three.
  ok("and no slot the league does not field", !tiles.includes("RB3"));
  ok("a row says what it projects", /PROJ/.test(t));
}

console.log("\n--- the reserve ---");
{
  const t = await body();
  ok("the reserve is its own group", /INJURED RESERVE/.test(t));
  ok("and says how full it is", /\d+ of \d+/.test(t));
  // The demand, not the report: a cleared player is on the books where he
  // sits, so a full roster is now over and nothing can be added until
  // somebody goes.
  ok("a cleared player is named, not merely counted", /Rashee Rice is cleared to play/.test(t));
  ok("and the manager is told to drop somebody", /Drop somebody before you can add anybody/.test(t));
}

console.log("\n--- a row opens the player ---");
{
  await page.getByText("Jahmyr Gibbs", { exact: true }).first().click();
  const shown = await page
    .waitForFunction(() => /GAME LOG/.test(document.body.innerText), undefined, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  ok("the sheet opens with his game log", shown);
  const sheet = page.getByRole("dialog");
  ok("and offers a trade", (await sheet.getByRole("button", { name: /TRADE/ }).count()) > 0
    || (await sheet.getByRole("link", { name: /TRADE/ }).count()) > 0);
  ok("and a drop", (await sheet.getByRole("button", { name: /^DROP/ }).count()) > 0);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/my-team-sheet.png` });
}

console.log("\n--- before anybody has played ---");
{
  // The hour before the first kickoff. A nought before anything is played is
  // not a score, so the total is a projection and says so.
  await load("?nothingplayed=1");
  const t = await body();
  ok("the total is a projection", /proj · best ball/.test(t));
  ok("not a score", !/pts · best ball/.test(t));
  ok("and no row reads nought", !/(^|\n)0\.0(\n|$)/.test(t));
}

console.log("\n--- when one man has played and the rest have not ---");
{
  // Thursday night. Best ball fills the slots with whoever is actually
  // scoring, so the roster is worth six, not nought.
  await load("?thursday=1");
  const t = await body();
  ok(`it counts the man who played (${t.match(/[\d.]+ (pts|proj) · best ball/)?.[0]})`,
    /6\.0 pts · best ball/.test(t));
}

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
