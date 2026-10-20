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

  // The counting group's rows, read off their subheaders: the position
  // leads each one. A league fielding one QB, two RB, two WR, a TE, two
  // flexes, a K and a D/ST counts ten, and never a third back outside a flex.
  const counting = await page.evaluate(() => {
    const label = [...document.querySelectorAll("*")].find((el) => el.children.length === 0 && el.textContent?.trim() === "COUNTING NOW");
    let group = label?.parentElement;
    while (group && !group.querySelector(".gl-row")) group = group.nextElementSibling ?? group.parentElement?.nextElementSibling ?? null;
    return [...(group?.querySelectorAll(".gl-row") ?? [])].map((row) => row.textContent ?? "");
  });
  ok(`ten men are counting (${counting.length})`, counting.length === 10);
  const flex = counting.filter((r) => /FLEX/.test(r)).length;
  ok(`two of them in the flexes (${flex})`, flex === 2);
  ok("a row says what it projects", /PROJ/.test(t));
}

console.log("\n--- who each man is ---");
{
  // Read off Jahmyr Gibbs's own row: his age beside his name, where he ranks
  // at his position across the league, and his face with his club's mark.
  const gibbs = page.locator(".gl-row", { hasText: "Jahmyr Gibbs" }).first();
  const text = (await gibbs.innerText()).replace(/\n/g, " ");
  ok(`his age is beside his name (${text.slice(0, 40)})`, /Jahmyr Gibbs \d{2}\b/.test(text));
  // The subheader: position, club, his game, then his rank at his position
  // across the league — the top-scoring back in the fixture's pool.
  const sub = text.match(/RB · DET · [^·]+ · RB\d+/)?.[0];
  ok(`and position, club, game and league rank under it (${sub})`, /RB · DET · .+ · RB1$/.test(sub ?? ""));
  ok("the headshot sits where the position tile was", (await gibbs.locator("[data-slot]").count()) === 0);
  ok("his headshot is there", (await gibbs.locator("img.gl-face").count()) === 1);
  const mark = await gibbs.locator('img[src*="logos"]').first().getAttribute("src").catch(() => null);
  ok(`and his club's logo (${mark})`, /det/.test(mark ?? ""));
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
  const st = await sheet.innerText();
  ok(`the sheet gives his rank at his position (${st.match(/RB\d+\nPOS RANK/)?.[0]?.replace("\n", " ")})`, /RB1\nPOS RANK/.test(st));
  ok(`and his age (${st.match(/\d+\nAGE/)?.[0]?.replace("\n", " ")})`, /\b\d{2}\nAGE/.test(st));
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
