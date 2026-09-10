/**
 * Does the League screen hold seven sections, and is any of its prose real?
 *
 * Two things a layout audit cannot see, because it only ever loads the default
 * tab: a section that renders nothing, and a generated headline that is
 * generated from nothing. The second is the one that matters here — the whole
 * premise of this screen is that it writes itself from the table, so the
 * check reads the numbers out of the sentences and compares them.
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
  const slug = tab.toLowerCase();
  await page
    .waitForFunction(
      (want) => (want === "overview" ? !location.search.includes("tab=") : location.search.includes(`tab=${want}`)),
      slug, { timeout: 15000 })
    .catch(() => {});
  await page.waitForTimeout(400);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/league-${slug}.png`, fullPage: true });
};

await page.goto(`${BASE}/the-league`, { waitUntil: "networkidle" });
await page
  .waitForFunction(() => /Overview/.test(document.body.innerText), undefined, { timeout: 20000 })
  .catch(() => {});
if (SHOTS) {
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/league-overview.png`, fullPage: true });
}

console.log("--- the header ---");
{
  const t = await body();
  ok("it names the league", /Pylon|League/i.test(t));
  ok("and the season", /20\d\d SEASON/.test(t));
  ok("all seven sections are offered",
    (await page.getByRole("tab").count()) === 7);
}

console.log("\n--- the overview writes itself ---");
{
  const t = await body();
  // Either it has something to say, or it says the season has not started.
  const running = /BEST VALUE|HOT STREAK|MVP/.test(t);
  const quiet = /Nothing has been graded yet/.test(t);
  ok(`it either tells a story or says why it cannot (${running ? "story" : quiet ? "quiet" : "neither"})`,
    running || quiet);

  if (running) {
    ok("and the card is named", /BEST VALUE|HOT STREAK|MVP/.test(t));
    // A rotating card with one story does not need dots; more than one does.
    const dots = await page.locator('button[aria-label^="Show "]').count();
    ok(`with a way to reach each one (${dots} dots)`, dots === 0 || dots >= 2);

    // The premise of this screen is that the prose is computed, so the
    // numbers in it are checked rather than its shape.
    //
    // The right answer is Tank Bigsby, and deliberately not the obvious one:
    // Rome Odunze is the highest-scoring receiver in the fixture and climbs
    // 27 spots from WR28, which looks like the story. Bigsby was drafted
    // RB54 and is the second-best back in the league on far fewer points —
    // 52 spots. A generator that picked the biggest scorer, or compared only
    // within a position, would name Odunze.
    await page.getByRole("button", { name: "Show best value" }).click();
    await page.waitForTimeout(500);
    const value = await body();
    ok(`the riser is the man who actually rose (${value.match(/RB54 → RB\d+/)?.[0] ?? "—"})`,
      /Tank Bigsby/.test(value) && /RB54 → RB2\b/.test(value));
    ok("the climb is counted, not asserted", /▲52/.test(value));
    ok("and the sentence agrees with the number",
      /52-spot climb/.test(value) && /54th RB off the board/.test(value));
    ok("the louder scorer did not win it on volume", !/Rome Odunze/.test(value));
    // Kyle McCord is unowned, QB59 off the board and top of the position on
    // points — the biggest climb in the league by a distance. The card is
    // about somebody's draft coming off, so a free agent cannot win it.
    ok("and a free agent did not win it at all", !/Kyle McCord/.test(value));

    await page.getByRole("button", { name: "Show hot streak" }).click();
    await page.waitForTimeout(500);
    const streak = await body();
    // Two graded weeks, one manager unbeaten in both.
    ok(`the streak is a real run (${streak.match(/W\d/)?.[0] ?? "—"})`, /W2\b/.test(streak));
    ok("and it names who is on it", /won 2 in a row|teams are riding 2/.test(streak));

    await page.getByRole("button", { name: "Show mvp" }).click();
    await page.waitForTimeout(500);
    const mvp = await body();
    // 61.4, 55.8, 52.3 — the three highest in the fixture, in that order.
    ok(`the top three are the top three (${mvp.match(/61\.4|55\.8|52\.3/g)?.join(", ") ?? "—"})`,
      /61\.4/.test(mvp) && /55\.8/.test(mvp) && /52\.3/.test(mvp));
    ok("and nobody below them is on it", !/22\.6|18\.4/.test(mvp));
    ok("nor the free agent outscoring all of them", !/Kyle McCord|70\.2/.test(mvp));
  }
}

console.log("\n--- week one, in play, nothing settled ---");
{
  // The state the league is actually in on the first Sunday. Players have
  // scored since Thursday; no week has been graded, because grading happens
  // when the last game ends. The Overview waited for the wrong event and sat
  // on its empty state for the whole of every week.
  await page.goto(`${BASE}/the-league?ungraded=1`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => /Overview/.test(document.body.innerText), undefined, { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(800);
  const t = await body();

  // Either wording of the empty state, so this keeps guarding if the copy
  // changes again.
  ok("it does not claim there is nothing to say",
    !/Nobody has scored yet|Nothing has been graded yet/.test(t));
  ok("the scoring cards are there", /BEST VALUE|MVP/.test(t));
  // A streak is made of results, and there are none — so that one card, and
  // only that one, stays away.
  ok("and the streak card is not, because no week has been settled",
    !/HOT STREAK/.test(t));

  await page.goto(`${BASE}/the-league`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => /Overview/.test(document.body.innerText), undefined, { timeout: 20000 })
    .catch(() => {});
}

console.log("\n--- the news is read off the table too ---");
{
  await open("News");
  const t = await body();
  // Week 2's 131.6 is the highest single week in the fixture.
  ok(`the highest week is the highest week (${t.match(/put up [\d.]+/)?.[0] ?? "—"})`,
    /put up 131\.6/.test(t));
  ok("the riser item agrees with the card", /Tank Bigsby is the league's biggest riser/.test(t));
  ok("and the points-for leader is named", /leads the league in points for/.test(t));
}

console.log("\n--- and every section renders ---");
for (const [tab, wanted, label] of [
  ["Standings", /POINTS FOR|PF|Ordered by/i, "the table"],
  ["Chat", /message|say something|chat/i, "the conversation"],
  ["Moves", /add|drop|trade|nothing/i, "the transactions"],
  ["News", /LEAGUE OFFICE|Nothing to report/i, "the league's own news"],
  ["Ranks", /rank|projection|consensus/i, "the board"],
  ["Rules", /roster|scoring|waiver/i, "how the league works"],
]) {
  await open(tab);
  const shown = await page
    .waitForFunction((src) => new RegExp(src, "i").test(document.body.innerText), wanted.source,
      { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  ok(`${tab} shows ${label}`, shown);
  ok(`${tab} is in the address, so back works`, page.url().includes(`tab=${tab.toLowerCase()}`));
}

console.log("\n--- the way back ---");
{
  await open("Overview");
  ok("Overview is the bare address", !page.url().includes("tab="));
  await page.goBack();
  await page.waitForTimeout(600);
  ok("the back button steps between sections", page.url().includes("tab=rules"));
}

console.log("\n--- and no section repeats its own name at it ---");
{
  // The old pages carried their own titles. Under a sub-tab that already says
  // the word, a second heading saying it is the duplication this removes.
  await open("Standings");
  // Visible ones. The section's own title is still in the DOM behind
  // `hidden`, which is the point — the component keeps working on its own
  // page — so counting nodes rather than what a reader can see measures the
  // wrong thing.
  const heads = await page.locator("h1:visible").allInnerTexts();
  ok(`one heading, the league's (${heads.join(" / ")})`, heads.length === 1);
}

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
