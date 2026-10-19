/**
 * Does Around League show the whole week, and are the league's stories real?
 *
 * Around League is the week's games, yours first, each one opening onto its
 * head to head. The stories the old Overview wrote (best value and MVP) ride
 * the General Manager tab's ticker now, and the premise is unchanged: the
 * prose is computed from the table, so the numbers in it are checked rather
 * than its shape.
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
const go = async (path, ready, shot) => {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page
    .waitForFunction((src) => new RegExp(src).test(document.body.innerText), ready.source, { timeout: 20000 })
    .catch(() => {});
  if (SHOTS && shot) {
    await mkdir(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/league-${shot}.png`, fullPage: true });
  }
};

console.log("--- the week's games ---");
{
  await go("/the-league", /WEEK \d/, "around");
  const t = await body();
  const games = page.locator('a.gl-press:not(.gl-score)[aria-label$="Open matchup."]');
  const count = await games.count();
  ok(`it says which week and how many games (${t.match(/WEEK \d+\n\d+ games?/)?.[0]?.replace("\n", " ")})`,
    new RegExp(`WEEK \\d+\\n${count} games?`).test(t));
  ok(`every game is there (${count})`, count >= 2);
  ok("your own comes first", /Steel Cartel/.test((await games.first().getAttribute("aria-label")) ?? ""));
  ok("and opens your own matchup", (await games.first().getAttribute("href")) === "/lineup");

  const other = await games.nth(1).getAttribute("href");
  ok(`somebody else's opens theirs (${other})`, /^\/lineup\?home=/.test(other ?? ""));
  await games.nth(1).click();
  await page.waitForFunction(() => /Back to your own matchup/.test(document.body.innerText), undefined,
    { timeout: 15000 }).catch(() => {});
  ok("with a way back to yours", /Back to your own matchup/.test(await body()));
}

console.log("\n--- and the rest of the league is still reachable ---");
{
  // The design has no chat or news; the redesign must not strand them.
  await go("/the-league", /MORE FROM THE LEAGUE/);
  for (const [href, label] of [["/chat", "chat"], ["/news", "news"], ["/rules", "rules"]]) {
    ok(`it links to the ${label}`, (await page.locator(`a[href="${href}"]`).count()) > 0);
  }
  await page.locator('a[href="/chat"]').first().click();
  await page.waitForURL("**/chat", { timeout: 15000 }).catch(() => {});
  ok(`the chat opens (${new URL(page.url()).pathname})`, new URL(page.url()).pathname === "/chat");
  ok("under The League's own tab",
    (await page.locator('[role="tab"][aria-selected="true"]', { hasText: /Around League/ }).count()) > 0);
}

console.log("\n--- the stories write themselves ---");
{
  await go("/free-agents", /BEST VALUE|MVP/, "ticker");
  const strip = async (label) =>
    (await page.locator(`[aria-label^="${label}:"]`).first().getAttribute("aria-label").catch(() => null)) ?? "";

  // The right answer is Tank Bigsby, and deliberately not the obvious one:
  // Rome Odunze is the highest-scoring receiver and climbs 27 spots, which
  // looks like the story. Bigsby was drafted RB54 and is the second-best back
  // in the league — 52 spots. Kyle McCord is unowned and climbs further, and
  // a free agent cannot have been somebody's value.
  const value = await strip("BEST VALUE");
  ok(`the riser is the man who actually rose (${value.slice(0, 60)})`,
    /^BEST VALUE: 1\. Tank Bigsby RB54 → RB2 ▲52/.test(value));
  ok("and a free agent did not win it at all", value !== "" && !/Kyle McCord/.test(value));

  // The strip changes over to the MVP list on its own.
  await page.waitForFunction(() => !!document.querySelector('[aria-label^="MVP:"]'), undefined,
    { timeout: 20000 }).catch(() => {});
  const mvp = await strip("MVP");
  // 61.4, 55.8, 52.3 — the three highest owned, in that order.
  const top = mvp.match(/\d+\.\d/g)?.slice(0, 3) ?? [];
  ok(`the top three are the top three (${top.join(", ")})`, top.join(",") === "61.4,55.8,52.3");
  ok("nor the free agent outscoring all of them", mvp !== "" && !/Kyle McCord|70\.2/.test(mvp));
}

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
