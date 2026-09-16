/**
 * Does The Pylon Report read on a phone, and do the arrows mean anything?
 *
 * Forty teams with a paragraph each is more writing than anything else in the
 * app, so most of this is about what is hidden: a board that is a scannable
 * list of ranks with the prose behind the row, rather than a wall.
 *
 * The arrows are the part worth measuring rather than eyeballing. A red
 * triangle and a green one are the same shape to somebody who cannot tell them
 * apart, so each one is checked for its colour, its direction and the words a
 * screen reader would say — and a team that held gets a dash, because silence
 * there reads as a column that failed to load.
 */
import { chromium } from "playwright";
import { routes } from "./fixture.mjs";
import { sessionCookie } from "./session.mjs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3123";
let failed = 0;
const ok = (label, got) => { console.log(`${got ? "PASS" : "FAIL"}  ${label}`); if (!got) failed++; };

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});

async function open(over = {}, width = 402) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 }, isMobile: true, hasTouch: true,
  });
  await ctx.addCookies([sessionCookie()]);
  const page = await ctx.newPage();
  await routes(page, over);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(800);
  return { page, ctx };
}

const card = (page) => page.locator("text=The Pylon Report").first();

console.log("--- it is on the home page ---");
let page, ctx;
{
  ({ page, ctx } = await open());
  ok("the column is there", (await card(page).count()) > 0);

  const t = await page.locator("body").innerText();
  ok("it says which week", /WEEK 2/.test(t));
  ok("and what the arrows are against", /VS WEEK 1/.test(t));

  // The NFL board opens first, which is the prototype's own default.
  ok("the NFL board is up", /San Francisco 49ers/.test(t));
  ok("with the ranking in order",
    t.indexOf("Chicago Bears") < t.indexOf("Kansas City Chiefs"));
  ok("and the honourable mentions under it",
    /HONORABLE MENTION/.test(t) && /New England Patriots/.test(t));
  ok("records are on the rows", /1-0|2-0/.test(t));

  // The three things the handoff's design leads with.
  ok("No. 1 gets the spotlight rather than a row",
    /NO\. 1 POWER RANK/.test(t) && /San Francisco 49ers/.test(t));
  ok("with its read already open", /NFL: San Francisco 49ers did something/.test(t));
  ok("the biggest riser and faller are called out",
    /BIGGEST RISER/.test(t) && /BIGGEST FALLER/.test(t));
  ok("each naming where it came from and where it landed", /NO\. \d+ → NO\. \d+/.test(t));
  // The list starts at two, and No. 1 is in the spotlight rather than in both
  // places: the label says 2-15 and the rows have to agree with it.
  ok("and the list starts at two", /POWER RANKINGS 2-15/.test(t));
  const ranks = await page.evaluate(() =>
    [...document.querySelectorAll('[data-report="pylon"] button[aria-expanded], [data-report="pylon"] button[aria-disabled]')]
      .map((b) => b.textContent?.trim().match(/^\d+/)?.[0])
      .filter(Boolean));
  ok(`the first row is rank two (${ranks.join(", ")})`, ranks[0] === "2");
  ok("and No. 1 is not also a row", !ranks.includes("1"));

  // The ordering value the prototype computes is deliberately never shown.
  // This report has no rating at all, so nothing should look like one.
  ok("no rating is printed anywhere", !/RATING|SOS|PRESEASON|WHAT MOVES THEM/i.test(t));
}

console.log("\n--- nothing published ---");
{
  // A heading over an empty box is worse than no heading, so the whole thing
  // is absent until a week is up.
  const bare = await open({ noReport: true });
  ok("the column removes itself entirely",
    (await bare.page.locator("text=The Pylon Report").count()) === 0);
  ok("and the rest of Home is untouched",
    /HERE NOW/.test(await bare.page.locator("body").innerText()));
  await bare.ctx.close();
}

console.log("\n--- the arrows ---");
{
  const arrows = await page.evaluate(() => {
    const out = {};
    for (const el of document.querySelectorAll('[role="img"][aria-label]')) {
      const row = el.parentElement;
      const name = row?.textContent?.match(/[A-Z][A-Za-z' .]+/g)?.slice(-1)[0]?.trim();
      const label = el.getAttribute("aria-label");
      if (!label || !/Up|Down|Unchanged|New this week/.test(label)) continue;
      out[label] = out[label] ?? [];
      out[label].push({
        text: el.textContent?.trim(),
        colour: getComputedStyle(el).color,
        row: name,
      });
    }
    return out;
  });

  const said = Object.keys(arrows);
  ok(`a climb says how far (${said.filter((s) => /^Up/.test(s)).join(", ")})`,
    said.includes("Up 6 places") && said.includes("Up 1 place"));
  ok(`and a fall too (${said.filter((s) => /^Down/.test(s)).join(", ")})`,
    said.includes("Down 2 places"));
  ok("one place is singular, not '1 places'", !said.some((s) => /\b1 places\b/.test(s)));
  ok("a team that held says so rather than saying nothing", said.includes("Unchanged"));
  ok("and a newcomer is marked", said.includes("New this week"));

  // Direction and colour both. Either on its own is a thing somebody cannot
  // read: two identical triangles, or two colours that are the same to them.
  const up = arrows["Up 6 places"]?.[0];
  const down = arrows["Down 2 places"]?.[0];
  ok(`up points up (${up?.text})`, up?.text?.startsWith("▲") === true);
  ok(`down points down (${down?.text})`, down?.text?.startsWith("▼") === true);
  ok(`and they are not the same colour (${up?.colour} / ${down?.colour})`,
    !!up?.colour && !!down?.colour && up.colour !== down.colour);

  // The number is on the arrow, not only in the label a sighted reader never
  // hears.
  ok(`the places are on the screen too (${up?.text})`, /6/.test(up?.text ?? ""));
}

console.log("\n--- the breakdowns are behind the rows ---");
{
  const body = () => page.locator("body").innerText();
  ok("the prose is not all on the screen at once",
    !/Georgia did something worth a paragraph/.test(await body()));

  // No. 1's read is in the spotlight, so it is the rows below it that hide
  // their prose.
  ok("the rows' prose is not all on the screen at once",
    !/Chicago Bears did something worth a paragraph/.test(await body()));

  await page.getByRole("button", { name: /Chicago Bears/ }).click();
  await page.waitForTimeout(250);
  ok("tapping a team opens its breakdown",
    /Chicago Bears did something worth a paragraph/.test(await body()));

  // One at a time, or the board becomes the wall it was trying not to be.
  await page.getByRole("button", { name: /Kansas City Chiefs/ }).click();
  await page.waitForTimeout(250);
  const t = await body();
  ok("opening another closes the first",
    /Kansas City Chiefs did something/.test(t) && !/Chicago Bears did something/.test(t));

  await page.getByRole("button", { name: /Kansas City Chiefs/ }).click();
  await page.waitForTimeout(250);
  ok("and tapping it again closes it", !/Kansas City Chiefs did something/.test(await body()));

  // Seattle has no write-up in the fixture. A row that opens onto nothing is
  // a tap that reads as broken.
  const dead = await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")]
      .find((b) => b.textContent?.includes("Seattle Seahawks"));
    return btn ? { expanded: btn.getAttribute("aria-expanded"), disabled: btn.getAttribute("aria-disabled") } : null;
  });
  ok(`a team with nothing written about it does not offer to open (${JSON.stringify(dead)})`,
    dead?.expanded == null && dead?.disabled === "true");
}

console.log("\n--- and the other board ---");
{
  // Leave a row open before switching, so "nothing is open" is a claim about
  // the switch rather than about a board nobody touched.
  await page.getByRole("button", { name: /Kansas City Chiefs/ }).click();
  await page.waitForTimeout(250);

  await page.getByRole("tab", { name: "College Football" }).click();
  await page.waitForTimeout(300);
  const t = await page.locator("body").innerText();

  ok("the college board replaces the NFL one",
    /Georgia/.test(t) && !/San Francisco 49ers/.test(t));
  ok("with its own honourable mentions", /Louisville/.test(t));
  ok("its own spotlight", /NO\. 1 IN THE POLL/.test(t));
  ok("and the poll's own label", /TOP 15 POLL 2-15/.test(t));

  // Switching boards closes whatever was open, or a breakdown from the other
  // board is left hanging under a team that is no longer there. Asked of the
  // rows, not of the page: No. 1's read lives in the spotlight and is always
  // showing, which is the design rather than a row left open.
  const openRows = () =>
    page.evaluate(() => [...document.querySelectorAll('[aria-expanded="true"]')].length);
  ok(`nothing is open on the board switched to (${await openRows()})`, (await openRows()) === 0);

  // And coming back. A board that only looks closed because the team that was
  // open is not on it would pass the check above and fail the reader.
  await page.getByRole("tab", { name: "NFL" }).click();
  await page.waitForTimeout(300);
  ok(`nor on the one switched away from (${await openRows()})`, (await openRows()) === 0);
  ok("its prose is put away with it",
    !/Kansas City Chiefs did something/.test(await page.locator("body").innerText()));
}

console.log("\n--- on the narrowest phone ---");
{
  const small = await open({}, 320);
  const over = await small.page.evaluate(() => {
    // The card itself, not whatever contains it: Home has a ticker whose rail
    // is deliberately wider than the screen, and walking up far enough to
    // reach it measures that instead.
    const root = document.querySelector('[data-report="pylon"]');
    if (!root) return null;
    let worst = 0;
    for (const n of root.querySelectorAll("*")) {
      const box = n.getBoundingClientRect();
      if (!box.width) continue;
      worst = Math.max(worst, Math.ceil(box.right - window.innerWidth));
    }
    return worst;
  });
  ok(`it stays inside 320px (${over}px over)`, over !== null && over <= 0);

  // A long franchise name must not push the record and the arrow off the row.
  ok("a long name is clipped rather than pushing the row wide",
    await small.page.evaluate(() => {
      const el = [...document.querySelectorAll("div")]
        .find((n) => n.textContent === "Jacksonville Jaguars" && !n.children.length);
      return el ? getComputedStyle(el).textOverflow === "ellipsis" : false;
    }));
  await small.ctx.close();
}

console.log("\n--- and the office puts one up ---");
{
  await page.goto(`${BASE}/commissioner`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => /The Pylon Report/.test(document.body.innerText), undefined,
    { timeout: 20000 }).catch(() => {});

  const desk = page.locator("#office-report");
  ok("the desk is in the office", (await desk.count()) === 1);

  // The sheet, as Excel hands it over: a header row, tab separated, with the
  // date serial Excel makes of "2-0" and a trailing space on a name.
  await desk.getByLabel("Rankings").fill(
    [
      "College Football\t\t\tNFL\t",
      "1\tGeorgia\t2-0\tSan Francisco 49ers\t1-0",
      "2\tMiami\t46023.0\tGreen Bay Packers \t0-1",
      "16\tLouisville\t1-1\tNew York Jets\t1-0",
    ].join("\n"),
  );
  await desk.getByLabel("Write-up").fill(
    [
      "NFL Post Week 1 Report",
      "San Francisco 49ers - Kyle Shanahan is still Kyle Shanahan.",
      "green bay packers - A concerning loss.",
      "Los Angeles Chargers - Nobody ranked them.",
    ].join("\n"),
  );
  await page.waitForTimeout(400);

  const preview = await page.locator('[data-preview="report"]').innerText();
  ok(`the preview counts both boards (${preview.split("\n")[0]})`,
    /College 2\+1/.test(preview) && /NFL 2\+1/.test(preview));
  ok("it shows what would be published", /1\. Georgia/.test(preview) && /HM: Louisville/.test(preview));
  ok("and how many carry a write-up", /2 of 2 WITH A WRITE-UP/.test(preview));

  // The two ways a paste goes wrong, both said out loud before anything is
  // published. This is the whole reason the preview exists.
  ok(`a write-up matching nobody is named (${preview.match(/No team on the board[^.]*\./)?.[0] ?? ""})`,
    /Los Angeles Chargers/.test(preview));
  ok("a mangled record is not shown as a number", !/46023/.test(preview));

  let sent = null;
  await page.route("**/api/report", async (r) => {
    if (r.request().method() === "POST") {
      sent = JSON.parse(r.request().postData() ?? "{}");
      return r.fulfill({ json: { ok: true, week: 2 } });
    }
    return r.fallback();
  });

  await page.getByRole("button", { name: /Publish week/ }).click();
  await page.waitForTimeout(600);

  ok(`it publishes what the preview showed (${sent?.college?.ranked?.length} + ${sent?.nfl?.ranked?.length})`,
    sent?.college?.ranked?.length === 2 && sent?.nfl?.ranked?.length === 2);
  ok("with the write-ups already joined on",
    /Kyle Shanahan/.test(sent?.nfl?.ranked?.[0]?.note ?? ""));
  ok("the trailing space and the lower case did not break the join",
    /concerning loss/.test(sent?.nfl?.ranked?.[1]?.note ?? ""));
  ok("the honourable mentions go with it", sent?.college?.honorable?.length === 1);
  ok("and the office says so", /is up/.test(await page.locator("body").innerText()));
  await ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
