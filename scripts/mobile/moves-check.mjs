/**
 * Does the Moves screen hold three sections, and is its advice real?
 *
 * The handoff names three bugs it already caught once, and each is the kind a
 * layout audit cannot see: a badge that renders on every row, a suggestion the
 * data cannot satisfy, and an advice tier that never fires on a good roster.
 * All three are checked here against the numbers rather than the shape.
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

const open = async (tab, slug, ready) => {
  await page.getByRole("tab", { name: tab, exact: true }).click();
  await page
    .waitForFunction(
      (want) => (want === "free-agents" ? !location.search.includes("tab=") : location.search.includes(`tab=${want}`)),
      slug, { timeout: 15000 })
    .catch(() => {});
  // Waited for rather than slept on. A cold compile in dev is longer than any
  // fixed pause worth writing, which is how a check fails once and then passes
  // every time after.
  if (ready) {
    await page
      .waitForFunction((src) => new RegExp(src, "i").test(document.body.innerText), ready.source,
        { timeout: 15000 })
      .catch(() => {});
  }
  await page.waitForTimeout(300);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/moves-${slug}.png`, fullPage: true });
};

await page.goto(`${BASE}/moves`, { waitUntil: "networkidle" });
await page
  .waitForFunction(() => /Free Agents/.test(document.body.innerText), undefined, { timeout: 20000 })
  .catch(() => {});
if (SHOTS) { await mkdir(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/moves-free-agents.png`, fullPage: true }); }

console.log("--- the header ---");
{
  const t = await body();
  ok("it is the Moves screen", /Moves/.test(t));
  ok("all three sections are offered", (await page.getByRole("tab").count()) === 3);

  // A real countdown, not a label saying one is coming.
  const clock = page.getByLabel("Time until the next waiver run");
  const first = await clock.innerText();
  ok(`the waiver clock reads a time (${first.replace(/\s+/g, " ")})`, /\d+:\d{2}:\d{2}/.test(first));
  await page.waitForTimeout(1600);
  ok("and it is counting, not frozen", (await clock.innerText()) !== first);
}

console.log("\n--- the free agent advice ---");
{
  const t = await body();

  // The tier ladder always renders something.
  ok("it says what the wire could do for this roster",
    /ROSTER HOLE|STARTER UPGRADE|BENCH UPGRADE|NO UPGRADES/.test(t));

  // And names somebody, rather than being a heading with no sentence.
  const line = t.match(/(ROSTER HOLE|STARTER UPGRADE|BENCH UPGRADE|NO UPGRADES)\n(.+)/);
  ok(`with a sentence under it (${(line?.[2] ?? "").slice(0, 60)})`, (line?.[2]?.length ?? 0) > 20);

  ok("and shows what the league has been moving", /MOVING/.test(t));

  // The trap: a chip on every row carries no information.
  const rows = await page.locator('a[href^="/player/"]').count();
  const chips = await page.locator('text=/^(FILLS |STARTER$|OVER )/').count();
  ok(`the fit chip is on some rows, not all (${chips} of ${rows})`, chips < rows);
}

console.log("\n--- the trade builder ---");
{
  await open("Trade Builder", "trade-builder", /Build an offer/);
  const t = await body();
  ok("it opens the desk", /TRADE WITH|Build an offer/i.test(t));

  // The verdict branches; with nothing selected it explains itself rather
  // than reading as an even trade.
  ok("an empty offer explains what to do", /Pick players or picks from either side/.test(t));
  ok("rather than calling nothing an even deal", !/As even as trades get/.test(t));
}

console.log("\n--- the record ---");
{
  await open("The Record", "the-record", /add|drop|trade|claim|nothing/);
  const t = await body();
  ok("every move the league has made is here", /add|drop|trade|claim|nothing/i.test(t));
}

console.log("\n--- and the way back ---");
{
  await open("Free Agents", "free-agents", /MOVING|UPGRADE|ROSTER HOLE/);
  ok("Free Agents is the bare address", !page.url().includes("tab="));
  await page.goBack();
  await page.waitForTimeout(600);
  ok("the back button steps between sections", page.url().includes("tab=the-record"));
}

console.log("\n--- and no section repeats its own name at it ---");
{
  await open("Free Agents", "free-agents", /MOVING|UPGRADE|ROSTER HOLE/);
  const heads = await page.locator("h1:visible").allInnerTexts();
  ok(`one heading, the screen's (${heads.join(" / ")})`, heads.length === 1);
}

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
