/**
 * Does pressing a matchup open that matchup?
 *
 * The bug this exists for: every card linked to /lineup?opponent=X, which is
 * the reader's own team against X. Pressing a game between two other managers
 * laid your roster out beside one of them — the fixture on the card and the
 * screen it opened were different games. Nothing in the type system or the
 * unit tests could catch that, because both screens worked; they just did not
 * agree about which game was being discussed.
 *
 * Run it with:
 *
 *   ./scripts/audit-mobile.sh --matchups
 */
import { chromium } from "playwright";
import { routes } from "./fixture.mjs";
import { sessionCookie } from "./session.mjs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3123";
let failed = 0;
const ok = (label, got) => {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  if (!got) failed++;
};

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
);
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3, isMobile: true, hasTouch: true,
});
await ctx.addCookies([sessionCookie()]);
const page = await ctx.newPage();
await routes(page);

console.log("--- the whole league, straight from a link ---");
{
  // The home page's card is a door into this, so the state it opens has to be
  // reachable by address rather than by pressing a toggle. Without it "every
  // game this week" is a page plus two taps.
  await page.goto(`${BASE}/matchups?view=league&week=3`, { waitUntil: "networkidle" });
  await page.waitForTimeout(700);
  const opened = await page.locator('a[aria-label^="Week"]').count();
  ok(`it opens on the whole league (${opened} fixtures)`, opened >= 2);
  ok("with the week already chosen",
    (await page.locator("select").inputValue().catch(() => "")) === "3");
}

console.log("\n--- the matchups list ---");
await page.goto(`${BASE}/matchups`, { waitUntil: "networkidle" });
// The whole league, which is where somebody else's fixture appears at all.
await page.getByRole("button", { name: "WHOLE LEAGUE" }).click();
await page.waitForTimeout(600);
ok("and pressing the toggle says so in the address",
  page.url().includes("view=league"));

const cards = page.locator('a[aria-label^="Week"]');
const count = await cards.count();
ok(`every fixture is a card you can press (${count} of them)`, count >= 2);

const hrefs = await cards.evaluateAll((els) => els.map((e) => e.getAttribute("href")));
console.log(hrefs.map((h) => `      ${h}`).join("\n"));

const others = hrefs.filter((h) => h.includes("home="));
ok("a fixture between two other franchises names both sides", others.length >= 1);
ok("and never says only 'opponent', which means 'me against them'",
  hrefs.every((h) => h.includes("home=") || !h.includes("opponent=")));
ok("every card carries the week it is drawn for", hrefs.every((h) => h.includes("week=")));

console.log("\n--- what a card shows ---");
const body = await page.locator("body").innerText();
ok("the projected finish sits under the score", /113\.7|125\.1|108\.2|118\.9/.test(body));
ok("win probability, as two percentages", /WIN PROBABILITY/i.test(body));
ok("how much football is left", /to play/i.test(body));
ok("and the record beside the manager", /\d-\d/.test(body));

const pcts = [...body.matchAll(/(\d+)%/g)].map((m) => Number(m[1]));
ok(`the percentages are whole numbers (${pcts.slice(0, 6).join(", ")})`, pcts.length >= 2);

console.log("\n--- pressing somebody else's game ---");
const target = others[0];
const params = new URLSearchParams(target.split("?")[1]);

// Pressed, not navigated to.
//
// This block was called "pressing somebody else's game" and did not press
// anything: it opened each fixture with page.goto, a full page load. That is
// the one way of reaching the screen where window.location is already correct
// when the board first renders, and the board read its parameters from
// window.location. So a soft navigation — a click, which is how everybody
// actually gets here — rendered before the address caught up, found no
// opponent, and asked for the reader's own game. The check passed for a year
// of the bug being live.
//
// Every request the board makes is watched too, because the visible symptom
// and the cause are one layer apart: the address bar said the right thing
// while the fetch behind it said /api/matchup?week=3.
const asked = [];
const watch = (r) => { if (r.url().includes("/api/matchup")) asked.push(r.url()); };
page.on("request", watch);
await page.locator(`a[href="${target}"]`).first().click();
await page
  .waitForFunction(() => /vs |Your matchup/.test(document.body.innerText), undefined, { timeout: 15000 })
  .catch(() => {});
await page.waitForTimeout(900);
page.off("request", watch);

ok(`the click lands on that fixture's address (${page.url().split("?")[1] ?? ""})`,
  page.url().endsWith(target));
ok(`and the board asks the server for that pair, not the reader's own game (${asked.length} calls)`,
  asked.length > 0 && asked.every((u) => u.includes("home=") && u.includes("opponent=")));

const head = await page.locator("body").innerText();

ok("it opens their game, not yours", !/\bYOU\b/.test(head.split("Best ball")[0] ?? head));
// The tap said "show me Kim against Priya". It used to answer with eighteen
// of the reader's own players and the game they asked for somewhere below.
ok("and does not lead with the reader's own roster",
  !/START RATE|DYNASTY · BEST BALL/.test(head));
ok("nor offers the reader's own roster controls",
  (await page.locator('button:has-text("ACTIVATE")').count()) === 0);
ok("the heading names them rather than saying 'Your matchup'",
  /Thunderbolts vs Gold Coast Gladiators/.test(head) && !/Your matchup/.test(head));
// "DOWN 2.8" over a game the reader is not playing in.
ok("the margin is stated, not taken personally",
  !/\b(UP|DOWN) \d/i.test(head) && /Gold Coast Gladiators by 2\.8/i.test(head));
ok("and there is only one bar under the scores",
  (head.match(/OF THE POINTS/g) ?? []).length === 0);
ok("both their franchises are named",
  /Thunderbolts/.test(head) && /Gold Coast Gladiators/.test(head));
ok("with a way back to your own week", /YOUR OWN MATCHUP/i.test(head));
ok("and the request asked for that pair",
  Boolean(params.get("home")) && Boolean(params.get("opponent")));

console.log("\n--- your own game ---");
await page.goto(`${BASE}/lineup`, { waitUntil: "networkidle" });
await page.waitForTimeout(600);
const mine = await page.locator("body").innerText();
ok("still says which side is you", /\bYOU\b/.test(mine));
ok("shows the score and where it is heading", /104\.6/.test(mine) && /125\.1/.test(mine));
ok("and the win probability", /WIN PROBABILITY/i.test(mine));
ok("with your own margin beside it", /up 6\.4/i.test(mine));
ok("and no second bar saying the same thing twice",
  (mine.match(/OF THE POINTS/g) ?? []).length === 0);
ok("the heading still says it is yours", /Your matchup/.test(mine));
ok("a player who has not kicked off shows who he plays and when",
  /@LV\s+\w{3}\s+\d/.test(mine));
ok("and a dash rather than a nought he has not scored", mine.includes("–"));
ok("with his projection beside it", /22\.00/.test(mine));

console.log("\n--- and any team's roster, in full ---");
// The rosters were never private; there was simply no page that asked, so the
// only way to see what a rival held was to open a trade with them.
await page.goto(`${BASE}/team/m4`, { waitUntil: "networkidle" });
await page.waitForTimeout(700);
const team = await page.locator("body").innerText();
ok("somebody else's roster opens", /Thunderbolts/.test(team));
ok("under their manager's name rather than the league format",
  /PRIYA RAGHUNATHAN/i.test(team) && !/DYNASTY · BEST BALL/i.test(team));
ok("with the whole roster on it, bench included", /BENCH|Injured reserve/i.test(team));
ok("and nothing on it can be pressed",
  (await page.locator('button:has-text("IR"), button:has-text("ACTIVATE")').count()) === 0);

await page.goto(`${BASE}/lineup`, { waitUntil: "networkidle" });
await page.waitForTimeout(700);
ok("while your own team still offers its one decision",
  (await page.locator('button:has-text("IR"), button:has-text("ACTIVATE")').count()) > 0);

console.log("\n--- and a Q only for somebody on the injury report ---");
// healthOf used to fall back to the pool's own questionable column whenever
// the report said nothing, which is the normal case for a fit player. The
// column is a snapshot from before the season, so 138 of 944 players wore a
// permanent Q. Christian McCaffrey is on this roster carrying that flag and
// on no report.
await page.goto(`${BASE}/lineup`, { waitUntil: "networkidle" });
await page.waitForTimeout(800);
const roster = await page.locator("body").innerText();
ok("the report's own players still wear their badge", /\bQ\b/.test(roster));
{
  const mcc = await page.locator('text=/Christian McCaffrey/').first();
  const row = mcc.locator("xpath=ancestor::*[self::div][2]");
  const text = (await row.count()) ? await row.innerText() : "";
  ok(`a stale draft-season flag draws nothing (${JSON.stringify(text.slice(0, 40))})`,
    !/\bQ\b/.test(text.replace(/Christian McCaffrey/g, "")));
}

console.log("\n--- and every franchise named is a way in ---");
for (const [where, sel] of [["the standings", "/standings"], ["the league page", "/league"]]) {
  await page.goto(`${BASE}${sel}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const links = await page.locator('a[href^="/team/"]').count();
  ok(`${where} leads to a roster (${links} of them)`, links > 0);
}

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
