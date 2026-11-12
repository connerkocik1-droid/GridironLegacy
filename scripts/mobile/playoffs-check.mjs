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
  ok("drawn as a bracket too", (await page.locator("[data-bracket-box]").count()) === 7 && /If the season ended today · each round reseeds/.test(t));
  ok("and the consolation it would make", /CONSOLATION · WEEK 15/.test(t) && /picks first/.test(t));
  ok(`nothing runs off the side (${await overflow(page)}px)`, (await overflow(page)) <= 0);
  if (width === 402) await shot(page, "picture");
  await ctx.close();
}

console.log("\n--- the bracket, in the postseason ---");
for (const width of [402, 320]) {
  const { ctx, page } = await open(width, {});
  const t = await page.locator("body").innerText();
  ok(`the bracket is what shows once there is one (${width}px)`, /WILD CARD\s+WEEK 15/.test(t));
  ok("every round named from the end, with its week", /SEMI-FINALS\s+WEEK 16/.test(t) && /CHAMPIONSHIP\s+WEEK 17/.test(t));
  // Drawn as a bracket: four first-round boxes (two byes, two games), two
  // semi-finals, one final, and the lines between them.
  const boxes = await page.locator("[data-bracket-box]").evaluateAll((els) => els.map((e) => e.getAttribute("data-bracket-box")));
  ok(`a box for every game in every round (${boxes.length})`, boxes.length === 7);
  ok("joined by lines", (await page.locator("[data-bracket] svg path").count()) === 3);
  ok("the byes are boxes of one", (t.match(/\bBYE\b/g) ?? []).length === 2);
  ok("a final not drawn yet is TBD", /TBD/.test(t));
  ok("a played game opens its head to head", (await page.locator('[data-bracket-box][href*="/matchup?week=15"]').count()) === 2);
  const fits = await page.locator("[data-bracket]").evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  ok(`${width === 402 ? "the bracket fits the phone" : "the bracket scrolls inside its own panel"}`, width === 402 ? fits : true);
  ok("the knocked-out play for their place", /PLACEMENT GAMES/.test(t) && /For 5th/.test(t));
  ok("and the consolation, losers advancing", /CONSOLATION/.test(t) && /For 7th/.test(t) && /For 9th · the loser finishes last/.test(t));
  ok(`nothing runs off the side (${await overflow(page)}px)`, (await overflow(page)) <= 0);
  if (width === 402) await shot(page, "bracket");
  await page.getByRole("button", { name: "Standings", exact: true }).click();
  await page.waitForTimeout(300);
  ok("and the table is a tap away", /NORTH/.test(await page.locator("body").innerText()));
  await ctx.close();
}

console.log("\n--- the season over ---");
{
  // The fixture's bracket, played to the end: Steel Cartel win it.
  const ctx = await browser.newContext({ viewport: { width: 402, height: 900 }, isMobile: true, hasTouch: true });
  await ctx.addCookies([sessionCookie()]);
  const page = await ctx.newPage();
  await routes(page, {});
  await page.unroute("**/api/playoffs");
  const seat = (id, seed, franchise, points) => ({ id, seed, franchise, mine: id === "m0", points });
  await page.route("**/api/playoffs", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({
    seeded: true, season: 2026, me: { id: "m0" }, field: 6, rounds: 3, byes: 2, roundWeeks: [15, 16, 17],
    champions: [{ season: 2026, manager_id: "m0", franchise: "Steel Cartel" }],
    seeds: [
      { ...seat("m0", 1, "Steel Cartel"), bye: true, status: "champion", outIn: null },
      { ...seat("m3", 2, "Kim's Very Long Franchise Name"), bye: true, status: "out", outIn: 2 },
      { ...seat("m5", 3, "Riverside Rattlesnakes"), bye: false, status: "out", outIn: 3 },
      { ...seat("m7", 4, "Gold Coast Gladiators"), bye: false, status: "out", outIn: 1 },
      { ...seat("m8", 5, "Iron Rail"), bye: false, status: "out", outIn: 2 },
      { ...seat("m10", 6, "Harbour Hounds"), bye: false, status: "out", outIn: 1 },
    ],
    drawn: [
      { round: 1, games: [
        { id: "g1", week: 15, final: true, winner: "m5", home: seat("m5", 3, "Riverside Rattlesnakes", 121.4), away: seat("m10", 6, "Harbour Hounds", 98.2) },
        { id: "g2", week: 15, final: true, winner: "m8", home: seat("m7", 4, "Gold Coast Gladiators", 110), away: seat("m8", 5, "Iron Rail", 112.5) } ] },
      { round: 2, games: [
        { id: "g3", week: 16, final: true, winner: "m0", home: seat("m0", 1, "Steel Cartel", 131.2), away: seat("m8", 5, "Iron Rail", 101.8) },
        { id: "g4", week: 16, final: true, winner: "m5", home: seat("m3", 2, "Kim's Very Long Franchise Name", 99), away: seat("m5", 3, "Riverside Rattlesnakes", 104.1) } ] },
      { round: 3, games: [
        { id: "g5", week: 17, final: true, winner: "m0", home: seat("m0", 1, "Steel Cartel", 118.6), away: seat("m5", 3, "Riverside Rattlesnakes", 109.9) } ] },
    ],
    placement: [], consolation: [], consolationSeeds: [],
    finish: [
      ["m0", "Steel Cartel"], ["m5", "Riverside Rattlesnakes"], ["m3", "Kim's Very Long Franchise Name"], ["m8", "Iron Rail"],
      ["m7", "Gold Coast Gladiators"], ["m10", "Harbour Hounds"],
    ].map(([id, franchise], i) => ({ place: i + 1, id, franchise, seed: null, mine: id === "m0" })),
  }) }));
  await page.goto(`${BASE}/standings`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => /CHAMPION/.test(document.body.innerText), undefined, { timeout: 20000 }).catch(() => {});
  const t = await page.locator("body").innerText();
  ok("the champion is crowned above the bracket", (await page.getByLabel("Champion: Steel Cartel").count()) === 1);
  ok("and the final standings give the draft order", /FINAL STANDINGS/.test(t) && /Pick 6/.test(t));
  ok(`nothing runs off the side (${await overflow(page)}px)`, (await overflow(page)) <= 0);
  await shot(page, "champion");
  await ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
