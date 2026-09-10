/**
 * Does My Team actually hold six screens, and does the roster say anything?
 *
 * The redesign folded six pages into one behind a strip of sub-tabs. Two
 * things can go wrong that a layout audit cannot see, because it only ever
 * loads the default tab: a section that renders nothing at all, and a start
 * rate that is really just a projection ranking wearing a percentage sign.
 * Both are checked here.
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
const open = async (tab) => {
  await page.getByRole("tab", { name: tab, exact: true }).click();
  // Waited for rather than slept on. A soft navigation in dev takes anywhere
  // from a few hundred milliseconds to a couple of seconds, and every fixed
  // pause short enough to be quick is long enough to be a coin toss.
  const slug = tab.toLowerCase();
  await page
    .waitForFunction(
      (want) => (want === "roster" ? !location.search.includes("tab=") : location.search.includes(`tab=${want}`)),
      slug,
      { timeout: 15000 },
    )
    .catch(() => {});
  // And then for the strip to finish scrolling the pressed tab into view.
  await page.waitForTimeout(400);
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/my-team-${tab.toLowerCase()}.png`, fullPage: true });
  }
};

await page.goto(`${BASE}/my-team`, { waitUntil: "networkidle" });
await page.waitForTimeout(1200);

if (SHOTS) {
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/my-team-roster.png`, fullPage: true });
}

console.log("--- the header ---");
{
  const t = await body();
  ok("it names the franchise", /Steel Cartel/.test(t));
  ok("and the manager", /Conner/i.test(t));
  ok("what the roster is worth this week", /SCORED|PROJECTED/.test(t));
  ok("how many are on it", /ON ROSTER/.test(t));
  ok("the record", /RECORD/.test(t));
  ok("and the points for", /POINTS FOR/.test(t));

  // The four numbers are the point of the row; four labels over four dashes
  // is a header that has failed and looks fine.
  const dashes = (t.match(/—/g) ?? []).length;
  ok(`with numbers under the labels, not dashes (${dashes} dashes)`, dashes < 3);
}

console.log("\n--- the roster ---");
{
  const t = await body();
  ok("it groups by position", /\bQB\b/.test(t) && /\bWR\b/.test(t) && /D\/ST/.test(t));
  ok("and says what the league starts at each", /START/.test(t));
  ok("every row carries a start rate", (t.match(/% START RATE/g) ?? []).length > 8);
  ok("the reserve is separate", /\bIR\b/.test(t));
  ok("and the man on it reads OUT rather than a rate", /OUT/.test(t));

  // The whole argument for the number: if it were an ordering, every rate
  // would be 100 or 0 and there would be nothing to draw.
  const rates = [...t.matchAll(/(\d+)% START RATE/g)].map((m) => Number(m[1]));
  const between = rates.filter((r) => r > 0 && r < 100);
  ok(`rates are not just 0 and 100 (${between.length} of ${rates.length} in between)`,
    between.length >= 3);
  ok("somebody starts every week", rates.includes(100));
  ok("and the numbers are sane", rates.every((r) => r >= 0 && r <= 100));

  // The chips mark the arrangement. Counted from the numbered ones and the
  // defence only: "QB", "TE" and "K" are also the group headings above the
  // cards, so counting those measures the headings and passes either way.
  const numbered = ["RB1", "RB2", "WR1", "WR2", "FLEX1", "FLEX2", "DST"];
  const found = [];
  for (const slot of numbered) {
    if (await page.locator(`text="${slot}"`).count()) found.push(slot);
  }
  ok(`the optimal lineup is chipped (${found.join(", ")})`, found.length === numbered.length);

  // A league fielding two backs must chip two, not three: the slot the chip
  // claims has to be one the league actually has.
  ok("and no slot the league does not field", !(await page.locator('text="RB3"').count()));
}

console.log("\n--- and every other section renders ---");
for (const [tab, wanted, label] of [
  ["Matchup", /WIN PROBABILITY|PROJECTED|Steel Cartel/i, "a scoreline"],
  ["News", /ALL|INJURY|ROLE|OTHER/, "the filter chips"],
  ["Watch", /Marquez Valdes-Scantling|watchlist/i, "the tracked players"],
  ["Trades", /trade|offer/i, "the desk"],
  ["Edit", /PIN|name|photo/i, "the forms"],
]) {
  await open(tab);
  // Waited for rather than slept on: every section fetches, and a fixed pause
  // long enough on one machine is a coin toss on another.
  const shown = await page
    .waitForFunction((src) => new RegExp(src).test(document.body.innerText),
      wanted.source, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  ok(`${tab} shows ${label}`, shown);
  // A section that renders its own heading under a tab already saying the
  // same word was the duplication this redesign was meant to remove.
  ok(`${tab} is in the address, so back works`,
    page.url().includes(`tab=${tab.toLowerCase()}`));
}

console.log("\n--- and the way back ---");
{
  await open("Roster");
  ok("Roster is the bare address", !page.url().includes("tab="));
  await page.goBack();
  await page.waitForTimeout(500);
  ok("the back button steps between sections", page.url().includes("tab=edit"));
}

console.log("\n--- the pencil ---");
{
  await page.goto(`${BASE}/my-team`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Edit team" }).click();
  await page.waitForTimeout(600);
  ok("it opens the Edit section", page.url().includes("tab=edit"));
}

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
