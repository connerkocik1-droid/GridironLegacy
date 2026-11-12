/**
 * Does the postseason read on a phone?
 *
 * Two shapes of the Standings page's playoff view. In the regular season, the
 * picture: who is in if it ended today, the marks beside the teams whose fate
 * is certain, and the first round and consolation it would make. In the
 * postseason, the bracket: every round named from the end, the byes, the
 * rounds still to be drawn, and the placement and consolation games beside
 * it — because every team plays on, and the finish decides the draft.
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

async function open(width, over) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, isMobile: true, hasTouch: true });
  await ctx.addCookies([sessionCookie()]);
  const page = await ctx.newPage();
  await routes(page, over);
  await page.goto(`${BASE}/standings`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => /NORTH|PLAYOFF|WILD CARD/.test(document.body.innerText), undefined, { timeout: 20000 }).catch(() => {});
  return { ctx, page };
}

const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const shot = async (page, name) => {
  if (!SHOTS) return;
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/playoffs-${name}.png`, fullPage: true });
};

console.log("--- the picture, in the regular season ---");
for (const width of [402, 320]) {
  const { ctx, page } = await open(width, { playoffs: "picture" });
  let t = await page.locator("body").innerText();
  ok(`the standings come first while the season is on (${width}px)`, /NORTH/.test(t) && !/IN THE FIELD/.test(t));
  await page.getByRole("button", { name: "Playoffs", exact: true }).click();
  await page.waitForTimeout(300);
  t = await page.locator("body").innerText();
  ok("the picture says what it is", /PLAYOFF PICTURE/.test(t) && /If the season ended today/.test(t));
  ok("the field and the outside", /IN THE FIELD/.test(t) && /ON THE OUTSIDE/.test(t));
  ok("certain fates are marked", /BYE ✓/.test(t) && /DIV ✓/.test(t) && /IN ✓/.test(t) && /\bOUT\b/.test(t));
  ok("the top two rest", (t.match(/first-round bye/g) ?? []).length >= 2);
  ok("the wild cards say who they would play", /v 6 Harbour Hounds/.test(t));
  ok("the first round it would make", /WILD CARD · WEEK 15/.test(t));
  ok("and the consolation it would make", /CONSOLATION · WEEK 15/.test(t) && /picks first/.test(t));
  ok(`nothing runs off the side (${await overflow(page)}px)`, (await overflow(page)) <= 0);
  if (width === 402) await shot(page, "picture");
  await ctx.close();
}

console.log("\n--- the bracket, in the postseason ---");
for (const width of [402, 320]) {
  const { ctx, page } = await open(width, {});
  const t = await page.locator("body").innerText();
  ok(`the bracket is what shows once there is one (${width}px)`, /WILD CARD · WEEK 15/.test(t));
  ok("every round named from the end", /SEMI-FINALS · WEEK 16/.test(t) && /CHAMPIONSHIP · WEEK 17/.test(t));
  ok("a round not drawn yet says so", /TO BE DRAWN/.test(t) && /The last two standing/.test(t));
  ok("the byes are in the first round", (t.match(/Bye · into the semi-finals/g) ?? []).length === 2);
  ok("the knocked-out play for their place", /PLACEMENT GAMES/.test(t) && /For 5th/.test(t));
  ok("and the consolation, losers advancing", /CONSOLATION/.test(t) && /For 7th/.test(t) && /For 9th · the loser finishes last/.test(t));
  ok("a level game says how it was settled", /level, the better seed goes through/.test(t));
  ok(`nothing runs off the side (${await overflow(page)}px)`, (await overflow(page)) <= 0);
  if (width === 402) await shot(page, "bracket");
  await page.getByRole("button", { name: "Standings", exact: true }).click();
  await page.waitForTimeout(300);
  ok("and the table is a tap away", /NORTH/.test(await page.locator("body").innerText()));
  await ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
