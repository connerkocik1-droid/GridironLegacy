/**
 * Does The Pylon Report read on a phone, and do the arrows mean anything?
 *
 * The report lives under Rankings now, as the design draws it: three boards
 * behind a chip strip on a phone, and the full web edition on a desktop.
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
const SHOTS = process.env.AUDIT_SHOTS ?? "";
let failed = 0;
const ok = (label, got) => { console.log(`${got ? "PASS" : "FAIL"}  ${label}`); if (!got) failed++; };

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});

const STUB = process.env.AUDIT_STUB ?? "http://127.0.0.1:54321";
const stub = (state) => fetch(`${STUB}/__state`, { method: "POST", body: JSON.stringify(state) });

async function open(width = 402) {
  const ctx = await browser.newContext({
    viewport: { width, height: 900 }, isMobile: width < 720, hasTouch: width < 720,
  });
  await ctx.addCookies([sessionCookie()]);
  const page = await ctx.newPage();
  await routes(page);
  await page.goto(`${BASE}/pylon-report`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => /PYLON ORDER|Nothing published/.test(document.body.innerText),
    undefined, { timeout: 20000 }).catch(() => {});
  return { page, ctx };
}

// The phone edition only: the web edition is in the same document, hidden.
const shown = (page) => page.locator(".gl-only-phone").innerText();

console.log("--- it is under Rankings, inside the app ---");
let page, ctx;
{
  ({ page, ctx } = await open());
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/pylon-report.png`, fullPage: true });
  const t = await shown(page);
  ok("it says which week", /WEEK 2 · PYLON ORDER/.test(t));
  ok("the college board is up first", /Georgia/.test(t) && !/San Francisco 49ers/.test(t));
  ok("in the published order", t.indexOf("Georgia") < t.indexOf("Miami") && t.indexOf("Miami") < t.indexOf("Texas"));
  ok("records are on the rows", /\b2-0\b/.test(t));
  ok("no rating is printed on a team board", !/RATING|SOS|PRESEASON/i.test(t));
}

console.log("\n--- the arrows ---");
{
  const arrows = await page.evaluate(() =>
    Object.fromEntries([...document.querySelectorAll('.gl-only-phone [role="img"][aria-label]')]
      .map((el) => [el.getAttribute("aria-label"), { text: el.textContent?.trim(), colour: getComputedStyle(el).color }])));
  const said = Object.keys(arrows);
  ok(`a climb says how far (${said.join(", ")})`, said.includes("Up 2 places"));
  ok("and a fall, in the singular for one", said.includes("Down 1 place") && said.includes("Down 2 places"));
  ok("a team that held says so rather than saying nothing", said.includes("Unchanged"));
  ok("and a newcomer is marked", said.includes("New this week"));
  const up = arrows["Up 2 places"];
  const down = arrows["Down 2 places"];
  ok(`up points up (${up?.text})`, up?.text === "▲2");
  ok(`down points down (${down?.text})`, down?.text === "▼2");
  ok(`and they are not the same colour (${up?.colour} / ${down?.colour})`,
    !!up?.colour && !!down?.colour && up.colour !== down.colour);
}

console.log("\n--- and the other boards ---");
{
  await page.getByRole("button", { name: "NFL Power 32", exact: true }).click();
  await page.waitForTimeout(300);
  let t = await shown(page);
  ok("the NFL board replaces the college one", /San Francisco 49ers/.test(t) && !/Georgia/.test(t));
  ok("with its own movement", /▲2/.test(t) && /NEW/.test(t));

  await page.getByRole("button", { name: "Pylon 50", exact: true }).click();
  await page.waitForTimeout(300);
  t = await shown(page);
  ok("a board nobody has published says so", /Nothing published yet/.test(t));
}

console.log("\n--- on the narrowest phone ---");
{
  const small = await open(320);
  const over = await small.page.evaluate(() => {
    const root = document.querySelector(".gl-only-phone");
    let worst = 0;
    for (const n of root?.querySelectorAll("*") ?? []) {
      const box = n.getBoundingClientRect();
      // The ticker's rail is deliberately wider than the screen.
      if (!box.width || n.closest(".gl-ticker-track")) continue;
      worst = Math.max(worst, Math.ceil(box.right - window.innerWidth));
    }
    return worst;
  });
  ok(`it stays inside 320px (${over}px over)`, over <= 0);
  await small.ctx.close();
}

console.log("\n--- on a desktop ---");
{
  const wide = await open(1280);
  const phone = await wide.page.locator(".gl-only-phone").isVisible();
  const web = await wide.page.locator(".gl-only-wide").isVisible();
  ok(`the web edition is what shows (${web ? "web" : phone ? "phone" : "neither"})`, web && !phone);
  await wide.ctx.close();
}

console.log("\n--- nothing published ---");
{
  await stub({ noReport: true });
  const bare = await open();
  ok("the board says so rather than drawing an empty list",
    /Nothing published yet/.test(await shown(bare.page)));
  await bare.ctx.close();
  await stub({ noReport: false });
}

console.log("\n--- and the office puts one up ---");
{
  await page.goto(`${BASE}/commissioner`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => /The Pylon Report/.test(document.body.innerText), undefined,
    { timeout: 20000 }).catch(() => {});

  const desk = page.locator("#office-report");
  ok("the desk is in the office", (await desk.count()) === 1);
  await ctx.close();
}

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
