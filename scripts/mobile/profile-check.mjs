/**
 * Does a player's profile offer the moves that are actually available?
 *
 * The rule is about which buttons are absent as much as which are there. A
 * man on somebody else's roster cannot be added however much a manager wants
 * him, and offering the button anyway is a tap that ends in a refusal — so
 * each of the four states is visited and checked for what it does not offer
 * as well as for what it does.
 *
 * The other half is the refusals that are real: a full roster, a full
 * reserve, a club that has kicked off. Those say why on the button rather
 * than hiding it, because a move that has vanished is a move somebody goes
 * looking for.
 */
import { chromium } from "playwright";
import { routes } from "./fixture.mjs";
import { sessionCookie } from "./session.mjs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3123";
let failed = 0;
const ok = (label, got) => { console.log(`${got ? "PASS" : "FAIL"}  ${label}`); if (!got) failed++; };

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
const ctx = await browser.newContext({
  viewport: { width: 402, height: 900 }, isMobile: true, hasTouch: true,
});
await ctx.addCookies([sessionCookie()]);
const page = await ctx.newPage();
await routes(page);

/** Open a profile and read the buttons on its ownership card. */
async function open(who) {
  await page.goto(`${BASE}/player/${encodeURIComponent(who)}`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => /roster|free agent|Held by|waivers/i.test(document.body.innerText),
      undefined, { timeout: 20000 })
    .catch(() => {});

  return page.evaluate(() =>
    [...document.querySelectorAll("button, a")]
      .map((el) => ({
        text: el.textContent?.trim() ?? "",
        off: el.hasAttribute("disabled"),
        href: el.getAttribute("href"),
      }))
      .filter((b) => /^(Drop|Trade|Add|Claim|Send to IR Slot|Off reserve|Add to reserve|His game|Your roster|Your reserve)/.test(b.text)));
}

console.log("--- one of your own ---");
{
  const buttons = await open("Puka Nacua");
  const has = (t) => buttons.some((b) => b.text === t);

  ok(`drop and trade are offered (${buttons.map((b) => b.text).join(", ")})`, has("Drop") && has("Trade"));
  ok("and nothing about adding him", !buttons.some((b) => /^(Add|Claim)/.test(b.text)));
  ok("nor the reserve, since the report says he is fit",
    !buttons.some((b) => /reserve/i.test(b.text)));

  const t = await page.locator("body").innerText();
  ok("the card says he is yours", /On\s+your roster/.test(t));
}

console.log("\n--- one of your own, hurt ---");
{
  const buttons = await open("Hurt And Mine");
  const has = (t) => buttons.some((b) => b.text === t);
  ok(`the reserve is offered too (${buttons.map((b) => b.text).join(", ")})`,
    has("Drop") && has("Trade") && has("Send to IR Slot"));
  ok("and it is the way in, not the way out", !has("Off reserve"));
}

console.log("\n--- one of your own, already on the reserve ---");
{
  const buttons = await open("On My Reserve");
  ok(`the offer is to bring him back (${buttons.map((b) => b.text).join(", ")})`,
    buttons.some((b) => b.text === "Off reserve") && !buttons.some((b) => b.text === "Send to IR Slot"));
  ok("the card says where he is", /on injured reserve/.test(await page.locator("body").innerText()));
}

console.log("\n--- one of your own, whose game has started ---");
{
  const buttons = await open("Already Playing");
  const drop = buttons.find((b) => /Drop|His game/.test(b.text));

  // The database refuses this whatever the page believes. A button that
  // always fails is worse than no button; a button that says why is an answer.
  ok(`the drop says why rather than vanishing (${drop?.text})`,
    drop?.text === "His game has started" && drop.off === true);
  ok("but a trade is still on", buttons.some((b) => b.text === "Trade"));
}

console.log("\n--- somebody else's ---");
{
  const buttons = await open("Held Elsewhere");
  ok(`a trade and nothing else (${buttons.map((b) => b.text).join(", ")})`,
    buttons.length === 1 && buttons[0].text === "Trade");
  ok("no add, no claim, no drop",
    !buttons.some((b) => /^(Add|Claim|Drop)/.test(b.text)));
  ok("the card names who holds him",
    /Held by/.test(await page.locator("body").innerText()));

  // The button is worth having only if it lands somewhere useful.
  const href = buttons[0].href ?? "";
  ok(`and it opens the desk against them (${href})`,
    href.includes("tab=trade-builder") && href.includes("with=m3") &&
      href.includes("want=Held+Elsewhere"));
}

console.log("\n--- a free agent ---");
{
  const buttons = await open("Blank Slate");
  ok(`he can be added (${buttons.map((b) => b.text).join(", ")})`,
    buttons.some((b) => b.text === "Add"));
  ok("and it is an add rather than a claim", !buttons.some((b) => b.text === "Claim"));
  ok("with no drop, since he is not yours", !buttons.some((b) => /^Drop/.test(b.text)));
  ok("the card says so", /free agent/i.test(await page.locator("body").innerText()));
}

console.log("\n--- a free agent on the wire ---");
{
  const buttons = await open("On The Wire");
  ok(`the add becomes a claim (${buttons.map((b) => b.text).join(", ")})`,
    buttons.some((b) => b.text === "Claim") && !buttons.some((b) => b.text === "Add"));
  ok("and the card says when he clears",
    /clears\s+in \d+ hours?/.test(await page.locator("body").innerText()));
}

console.log("\n--- a free agent hurt enough for the reserve ---");
{
  const buttons = await open("Hurt And Free");
  const add = buttons.find((b) => /^(Add|Your roster)/.test(b.text));

  ok(`a full roster refuses the add and says why (${add?.text})`,
    add?.text === "Your roster is full — drop somebody first" && add.off === true);

  // The one add that costs no roster spot, and the whole reason it is offered
  // on a roster with no room: he cannot play.
  ok(`but the reserve is still open to him (${buttons.map((b) => b.text).join(", ")})`,
    buttons.some((b) => b.text === "Add to reserve" && !b.off));
}

console.log("\n--- and pressing one ---");
{
  let sent = null;
  await page.route("**/api/waivers", async (r) => {
    sent = { method: r.request().method(), body: JSON.parse(r.request().postData() ?? "{}") };
    return r.fulfill({ json: { ok: true, mode: "now" } });
  });

  await open("Blank Slate");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await page.waitForTimeout(700);

  ok(`the add reaches the wire endpoint (${JSON.stringify(sent)})`,
    sent?.method === "POST" && sent.body.add === "Blank Slate");
  ok("and the page says what happened",
    /is on your roster/.test(await page.locator("body").innerText()));
}

console.log("\n--- a thumb can hit them ---");
{
  await open("Hurt And Mine");
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("button, a")]
      .filter((el) => /^(Drop|Trade|Send to IR Slot)$/.test(el.textContent?.trim() ?? ""))
      .map((el) => ({ text: el.textContent?.trim(), h: Math.round(el.getBoundingClientRect().height) }))
      .filter((b) => b.h < 40));
  ok(`every button is at least 40px tall (${small.length} too small)`, small.length === 0);
}

await ctx.close();
await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
