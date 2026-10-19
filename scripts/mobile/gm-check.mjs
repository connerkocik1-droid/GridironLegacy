/**
 * Does the General Manager tab still give real advice, and can an offer be
 * answered rather than only taken or refused?
 *
 * The Moves screen's three sections became the General Manager tab's own
 * sub-tabs. The checks here are the ones a layout audit cannot see: advice
 * the data cannot satisfy, a fit chip on every row, and a counter that does
 * not carry the offer it is answering.
 */
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { RANKINGS, routes } from "./fixture.mjs";
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
// Waited for rather than slept on: a cold compile in dev is longer than any
// fixed pause worth writing.
const go = async (path, ready, shot) => {
  await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
  await page
    .waitForFunction((src) => new RegExp(src, "i").test(document.body.innerText), ready.source, { timeout: 20000 })
    .catch(() => {});
  await page.waitForTimeout(300);
  if (SHOTS) {
    await mkdir(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/gm-${shot}.png`, fullPage: true });
  }
};

// A wire with something on it.
//
// The shared fixture's unowned pool is one quarterback, which cannot show
// whether the advice ranks positions sensibly — the whole question is what it
// picks when a quarterback and a receiver are both there. Overridden here
// rather than in the fixture because the League tab's stories are tuned
// against that pool.
//
// Baker Mayfield out-rates Jaxon Smith-Njigba by nine points a game and is
// barely better than the next free quarterback; Smith-Njigba has a wire of
// nobody behind him. This league starts one quarterback, so the receiver is
// the pickup and the ordering has to say so.
const WIRE = {
  ...RANKINGS,
  points: {
    ...RANKINGS.points,
    // The shared fixture leaves Kyle McCord unowned and top of the league on
    // points, which makes him a genuine upgrade on this manager's starting
    // quarterback — a recommendation that is right, and not the one under
    // test. Held down here so the question is only about second bodies.
    "Kyle McCord": { total: 40.0, games: 2 },
    "Baker Mayfield": { total: 52.0, games: 2 },
    "Kyler Murray": { total: 50.0, games: 2 },
    "Denver Broncos D/ST": { total: 24.0, games: 2 },
    "Seattle Seahawks D/ST": { total: 22.0, games: 2 },
    "Jaxon Smith-Njigba": { total: 34.0, games: 2 },
    "Jayden Reed": { total: 5.0, games: 2 },
    // This manager's own kicker and defense, which the shared pool never
    // scored. Without them the roster reads as having none, and any free
    // defense is an upgrade on a blank — which is a different bug from the
    // one under test.
    "Baltimore Ravens D/ST": { total: 30.0, games: 2 },
    "Brandon Aubrey": { total: 24.0, games: 2 },
    // Two men who do have rows on the wire, so the chips can be read off the
    // page: a tight end with nobody behind him, and a second defense that
    // out-rates the weakest man on this roster while being worth a point less
    // than the free defense nobody has taken either.
    "Tyler Warren": { total: 30.0, games: 2 },
  },
};
await page.route("**/api/rankings", (r) => r.fulfill({ json: WIRE }));

const ADVICE = /(FILLS A HOLE|STARTER UPGRADE|BENCH UPGRADE|NO UPGRADES)\n(.+)/;

console.log("--- the old address ---");
{
  await go("/moves", /FREE AGENTS|OPEN MARKET/, "moves");
  ok(`/moves lands on Free Agency (${new URL(page.url()).pathname})`, new URL(page.url()).pathname === "/free-agents");
}

console.log("\n--- the free agent advice ---");
{
  const t = await body();
  const line = t.match(ADVICE);
  ok("it says what the wire could do for this roster", !!line);
  ok(`with a sentence under it (${(line?.[2] ?? "").slice(0, 60)})`, (line?.[2]?.length ?? 0) > 20);

  // This league starts one quarterback and the manager already holds one, so
  // the quarterback who out-rates everybody is worth only the point he clears
  // the next free one by. Named by what he plays rather than by who he is.
  const advice = line?.[2] ?? "";
  ok(`the advice names somebody who would actually play (${advice.slice(0, 90)})`,
    /Smith-Njigba|Tyler Warren|Ashton Jeanty/.test(advice));
  ok("and not the quarterback, who out-rates all of them",
    !/Mayfield/.test(advice) && !/Murray/.test(advice) && !/McCord/.test(advice));
  ok("nor a defense", !/Broncos|Seahawks|Ravens/.test(advice));
}

console.log("\n--- the fit chips ---");
{
  // The trap: a chip on every row carries no information.
  const rows = await page.locator(".gl-row").count();
  const chips = await page.locator(".gl-row span", { hasText: /^(FILLS |STARTER$|OVER )/ }).count();
  ok(`the fit chip is on some rows, not all (${chips} of ${rows})`, chips > 0 && chips < rows);

  const chipOf = (name) =>
    page.evaluate((who) => {
      const row = [...document.querySelectorAll(".gl-row")].find((r) => r.textContent?.includes(who));
      return [...(row?.querySelectorAll("span") ?? [])]
        .map((el) => el.textContent?.trim() ?? "")
        .find((x) => /^(FILLS |STARTER$|OVER )/.test(x)) ?? null;
    }, name);
  ok(`the tight end with an empty position behind him is chipped (${await chipOf("Tyler Warren")})`,
    (await chipOf("Tyler Warren")) != null);
  ok(`the second defense is not (${await chipOf("Seattle Seahawks D/ST")})`,
    (await chipOf("Seattle Seahawks D/ST")) == null);
}

console.log("\n--- what a free agent has actually done ---");
{
  const t = await body();
  ok("a free agent's season is on his row", /41\.2/.test(t));
  ok("with a per-game rate beside it", /20\.6 PG/.test(t));
}

console.log("\n--- the trade builder ---");
{
  await go("/trade-builder", /YOU SEND/, "trades");
  ok("an empty offer explains what to do rather than calling it even",
    !/As even as trades get/.test(await body()));

  // Between yes and no, which is where most trades in a league of twelve
  // actually live. The fixture's received offer is two players out, one in.
  const counter = page.getByRole("button", { name: "Counter" });
  ok(`a received offer can be countered (${await counter.count()})`, (await counter.count()) === 1);
  ok("and only the received one can be accepted",
    (await page.getByRole("button", { name: "ACCEPT" }).count()) === 1);
  const box = await counter.first().boundingBox();
  ok(`a thumb can hit it (${Math.round(box?.height ?? 0)}px)`, (box?.height ?? 0) >= 32);

  await counter.first().click();
  await page.waitForFunction(() => /Answering/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => {});
  const t = await body();
  ok(`it says whose offer it is answering (${t.match(/Answering [^.]*/)?.[0] ?? ""})`, /Answering .*offer/.test(t));

  // Their terms already in, sides swapped, so changing one thing does not
  // mean retyping the four you agreed on.
  const checked = await page.evaluate(() =>
    [...document.querySelectorAll(".gl-row")]
      .filter((r) => r.querySelector('[aria-checked="true"], [data-checked="true"]') || /✓/.test(r.textContent ?? ""))
      .map((r) => r.textContent ?? ""));
  const sends = Number((t.match(/YOU SEND\n([\d.]+)/) ?? [])[1] ?? 0);
  ok(`what they asked for is loaded as yours to send (${sends})`, sends > 0);
  ok(`and what they offered as yours to get (${checked.length} ticked)`,
    checked.some((r) => /Trey McBride/.test(r)) || /Trey McBride/.test(t));

  await page.getByRole("button", { name: "Start over" }).click();
  await page.waitForTimeout(400);
  const after = await body();
  ok("starting over drops the counter", !/Answering/.test(after));
  ok(`and empties the deal (${after.match(/YOU SEND\n[\d.]+/)?.[0]?.replace("\n", " ")})`, /YOU SEND\n0\.0/.test(after));
}

console.log("\n--- the record ---");
{
  await go("/activity", /ADD|DROP|TRADE|CLAIM|nothing/, "activity");
  ok("every move the league has made is here", /add|drop|trade|claim|nothing/i.test(await body()));
}

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
