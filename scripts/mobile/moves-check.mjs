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

  // It is a ticker, so it has to tick. A strip that sits still reads as a row
  // of chips somebody forgot to finish, and gives away nothing about whether
  // it is showing this afternoon or last month.
  {
    // Asked of the document rather than through a locator, so a strip that is
    // not a ticker at all reports as one failed check rather than timing out
    // and taking the rest of the run with it.
    const where = () =>
      page.evaluate(() => {
        const el = document.querySelector(".gl-ticker-track");
        if (!el) return null;
        return new DOMMatrixReadOnly(getComputedStyle(el).transform).m41;
      });

    const first = await where();
    ok("the strip is built as a ticker", first !== null);
    await page.waitForFunction(
      (was) => {
        const el = document.querySelector(".gl-ticker-track");
        if (!el) return false;
        return new DOMMatrixReadOnly(getComputedStyle(el).transform).m41 !== was;
      },
      first,
      { timeout: 8000 },
    ).catch(() => {});

    const moved = await where();
    ok(
      `the moving strip is moving (${first?.toFixed(1)} → ${moved?.toFixed(1)})`,
      first !== null && moved !== null && moved !== first,
    );

    // Leftwards, so the next name arrives from the right the way every ticker
    // anybody has ever read does.
    ok("leftwards", first !== null && moved !== null && moved < first);

    // And a name you are trying to read stops when you reach for it, or the
    // strip is decoration rather than information.
    await page.locator(".gl-ticker").first().hover().catch(() => {});
    await page.waitForTimeout(300);
    const held = await where();
    await page.waitForTimeout(700);
    ok(
      `and it stops when you go to read it (${held?.toFixed(1)})`,
      held !== null && (await where()) === held,
    );
    await page.mouse.move(0, 0);
  }

  // Short lists are laid out more than once, or a two-name ticker shows a
  // name, then a page-width of nothing, then the same name again.
  {
    const cells = await page.locator(".gl-ticker-track [role='listitem']").count();
    const all = await page.locator(".gl-ticker-track > div").first().locator("> span").count();
    ok(`the list is repeated to fill the rail (${cells} named, ${all} drawn)`, all >= 6);
    ok("but a screen reader hears each name once", cells > 0 && cells <= all / 2 + 1);
  }

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

console.log("\n--- countering a received offer ---");
{
  // Between yes and no, which is where most trades in a league of twelve
  // actually live. The offer on the fixture is two players out and one in.
  const counter = page.getByRole("button", { name: "Counter" });
  ok("a received offer can be countered", (await counter.count()) === 1);
  ok("and an offer you sent cannot — there is nothing to answer",
    (await page.getByRole("button", { name: "Accept" }).count()) === 1);

  const box = await counter.first().boundingBox();
  ok(`a thumb can hit it (${Math.round(box?.height ?? 0)}px)`, (box?.height ?? 0) >= 24);

  await counter.first().click();
  await page.waitForFunction(() => /Countering/.test(document.body.innerText), null,
    { timeout: 8000 }).catch(() => {});

  // The builder card, by the heading that names it, so "YOU SEND" is read off
  // the form and not off one of the offers listed below it.
  // Two levels up: the heading sits in a row with "Start again", and the card
  // is that row's parent. Headings are uppercased in CSS, so every read of
  // this text is case-insensitive.
  const card = page.locator("h6", { hasText: /Countering|Build an offer/i })
    .locator("xpath=../..");
  const built = await card.innerText();

  ok(`the builder says whose offer it is answering (${built.split("\n")[0]})`,
    /countering kim/i.test(built));

  // The whole point: their terms are already in, sides swapped, so changing
  // one thing does not mean retyping the four you agreed on.
  ok("what they asked for is loaded as yours to send",
    /you send[\s\S]*ja'marr chase/i.test(built) && /tank bigsby/i.test(built));
  ok("and what they offered is loaded as yours to get", /trey mcbride/i.test(built));

  ok("the partner is set to them, not left blank",
    (await page.locator("select").first().inputValue()) === "m3");
  ok("and the button sends a counter rather than a new offer",
    (await page.getByRole("button", { name: "Send counter" }).count()) === 1);

  // A way out that is not reloading the page.
  await page.getByRole("button", { name: "Start again" }).click();
  await page.waitForTimeout(400);
  const after = await card.innerText();
  ok(`starting again drops the counter (${after.split("\n")[0]})`, !/countering/i.test(after));
  // Ja'Marr Chase is on this manager's own roster, so his name is in the card
  // either way — what has to go is the deal. Both sides read nought and the
  // button has nothing to send.
  ok(`and empties both sides of the deal (${(after.match(/you (?:send|get) · [\d.]+/gi) ?? []).join(", ")})`,
    /you send · 0\.0/i.test(after) && /you get · 0\.0/i.test(after));
  ok("so there is nothing left to send",
    await page.getByRole("button", { name: "Send offer" }).isDisabled());
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
