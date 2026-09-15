/**
 * Does My Team actually hold six screens, and does the roster say anything?
 *
 * The redesign folded six pages into one behind a strip of sub-tabs. Two
 * things can go wrong that a layout audit cannot see, because it only ever
 * loads the default tab: a section that renders nothing at all, and a start
 * rate that is really just a projection ranking wearing a percentage sign.
 * Both are checked here.
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
const open = async (tab) => {
  await page.getByRole("tab", { name: tab, exact: true }).click();
  // Waited for rather than slept on. A soft navigation in dev takes anywhere
  // from a few hundred milliseconds to a couple of seconds, and every fixed
  // pause short enough to be quick is long enough to be a coin toss.
  const slug = tab.toLowerCase();
  await page
    .waitForFunction(
      (want) => (want === "roster" ? !location.search.includes("tab=") : location.search.includes(`tab=${want}`)),
      slug,
      { timeout: 15000 },
    )
    .catch(() => {});
  // And then for the strip to finish scrolling the pressed tab into view.
  await page.waitForTimeout(400);
  if (SHOTS) {
    await page.screenshot({ path: `${SHOTS}/my-team-${tab.toLowerCase()}.png`, fullPage: true });
  }
};

// Three players this manager does not hold, outscoring three he does.
//
// Overridden here rather than added to the shared fixture: the League tab's
// stories are tuned against that pool — the biggest riser, the top three — and
// three new high scorers rewrite all of them. What this page needs is only
// that the pool be bigger than the roster, so a rank taken across the league
// is visibly not a rank taken across the twelve men on this screen.
const POOL = {
  ...RANKINGS,
  points: {
    ...RANKINGS.points,
    "Justin Jefferson": { total: 80.0, games: 2 },
    "Amon-Ra St. Brown": { total: 70.0, games: 2 },
    "Saquon Barkley": { total: 65.0, games: 2 },
  },
};
await page.route("**/api/rankings", (r) => r.fulfill({ json: POOL }));

await page.goto(`${BASE}/my-team`, { waitUntil: "networkidle" });
// Waited for rather than slept on. Everything below polls; this first load did
// not, and a cold compile in dev is slower than any fixed pause worth writing
// — which is how this check failed once and then passed seven times.
await page
  .waitForFunction(() => /PPG|NOT YET RANKED/.test(document.body.innerText), undefined, { timeout: 20000 })
  .catch(() => {});

if (SHOTS) {
  await mkdir(SHOTS, { recursive: true });
  await page.screenshot({ path: `${SHOTS}/my-team-roster.png`, fullPage: true });
}

console.log("--- the header ---");
{
  const t = await body();
  ok("it names the franchise", /Steel Cartel/.test(t));
  ok("and the manager", /Conner/i.test(t));
  ok("what the roster is worth this week", /SCORED|PROJECTED/.test(t));
  ok("how old the roster is", /AVG AGE/.test(t));
  ok("the record", /RECORD/.test(t));
  ok("and what it scores a week", /PTS \/ GAME/.test(t));

  // The four numbers are the point of the row, and four labels over four
  // dashes is a header that has failed and looks fine. Read off the labels
  // themselves rather than counted across the page — an IR row draws a dash
  // for its projection too, so a page-wide count measures the roster.
  const stats = await page.evaluate(() =>
    ["PROJECTED", "SCORED", "AVG AGE", "RECORD", "PTS / GAME"].flatMap((label) => {
      const cell = [...document.querySelectorAll("div")].find(
        (el) => el.children.length === 0 && el.textContent?.trim() === label,
      );
      const value = cell?.previousElementSibling?.textContent?.trim();
      return value == null ? [] : [[label, value]];
    }),
  );
  ok(`all four stats found (${stats.map(([l]) => l).join(", ")})`, stats.length === 4);
  ok(
    `and every one of them is a number (${stats.map(([, v]) => v).join(" / ")})`,
    stats.length === 4 && stats.every(([, v]) => v !== "—" && v.length > 0),
  );
}

console.log("\n--- the roster ---");
{
  const t = await body();
  ok("it groups by position", /\bQB\b/.test(t) && /\bWR\b/.test(t) && /D\/ST/.test(t));
  ok("and says what the league starts at each", /START/.test(t));
  ok("the reserve is separate", /\bIR\b/.test(t));
  ok("and the man on it says so rather than carrying a rank", /ON RESERVE/.test(t));

  // The chips mark the arrangement. Counted from the numbered ones and the
  // defense only: "QB", "TE" and "K" are also the group headings above the
  // cards, so counting those measures the headings and passes either way.
  const numbered = ["RB1", "RB2", "WR1", "WR2", "FLEX1", "FLEX2", "DST"];
  // Read off the slot chips themselves. A rank chip says "RB1" as well now,
  // and a page-wide text search would find one of those and pass whether the
  // lineup was chipped or not.
  const chipped = await page.evaluate(() =>
    [...document.querySelectorAll('[data-chip="slot"]')].map((el) => el.textContent?.trim()));
  const found = numbered.filter((slot) => chipped.includes(slot));
  ok(`the optimal lineup is chipped (${found.join(", ")})`, found.length === numbered.length);

  // A league fielding two backs must chip two, not three: the slot the chip
  // claims has to be one the league actually has.
  ok("and no slot the league does not field", !chipped.includes("RB3"));
}

console.log("\n--- what each man is, and what he is worth ---");
{
  // Start rate said how often somebody made this roster's own lineup, which is
  // a fact about the roster. These two say what the player is: where he ranks
  // at his position across the league's whole pool, and what he has actually
  // been worth a week.
  const chips = await page.evaluate(() =>
    [...document.querySelectorAll('[data-chip="rank"]')].map((el) => {
      const s = getComputedStyle(el);
      const ppg = el.parentElement?.querySelector('[data-chip="ppg"]');
      const fill = ppg?.querySelector("span[aria-hidden]");
      return {
        rank: el.textContent?.trim(),
        title: el.getAttribute("title"),
        glow: s.boxShadow,
        background: s.backgroundColor,
        ppg: ppg?.textContent?.trim(),
        // The bar behind the rate, as a share of the chip it sits in.
        fill: fill && ppg
          ? Math.round((fill.getBoundingClientRect().width /
              Math.max(1, ppg.getBoundingClientRect().width)) * 100)
          : null,
      };
    }));

  ok(`every scored man carries a rank chip (${chips.length})`, chips.length >= 8);
  ok("start rate is gone", !/START RATE/.test(await body()));

  // Against the whole pool, not this roster. Gibbs is the best back this
  // manager holds and the second in the league behind Bijan Robinson; Odunze
  // is his best receiver and the third in the league. A rank taken across the
  // roster would read RB1 and WR1 and be wrong about both.
  const ranks = chips.map((c) => c.rank);
  ok(`ranks are against the league, not the roster (${ranks.join(", ")})`,
    ranks.includes("RB2") && ranks.includes("WR3") && !ranks.includes("RB1"));

  const gibbs = chips.find((c) => c.rank === "RB2");
  const odunze = chips.find((c) => c.rank === "WR3");

  // 55.8 over two games. A total printed instead of a rate would read 55.8.
  ok(`the rate is per game, not the total (${gibbs?.ppg})`, gibbs?.ppg === "27.9 PPG");
  ok(`and the receiver's too (${odunze?.ppg})`, odunze?.ppg === "30.7 PPG");

  // Highlighted, not just written. A twelve-team league fielding two backs and
  // two flexes starts 48, so RB1 is in the top half of them and glows.
  ok(`the top of a position glows (${gibbs?.glow})`,
    !!gibbs?.glow && gibbs.glow !== "none");
  ok("and it is tinted rather than transparent",
    !!gibbs?.background && !/rgba\(0, 0, 0, 0\)/.test(gibbs.background));

  // The chip says what the tier is measured against, so the number is not a
  // claim the reader has to take on faith.
  ok(`and it says what it is measured against (${gibbs?.title})`,
    /of the 48 this league starts/.test(gibbs?.title ?? ""));

  // The rate chip is filled against the best at the position, so the fill is
  // the comparison the number is making. Brock Bowers is the best tight end in
  // the fixture's pool, so his runs full; Marvin Harrison Jr. is sixth of the
  // receivers, so his does not.
  const bowers = chips.find((c) => c.rank === "TE1");
  const harrison = chips.find((c) => c.rank === "WR6");
  ok(`the best at a position fills his bar (${bowers?.fill}%)`, (bowers?.fill ?? 0) >= 95);
  ok(`and a man well down his own reads short (${harrison?.fill}%)`,
    harrison != null && harrison.fill != null && harrison.fill > 0 && harrison.fill < 60);
}

console.log("\n--- before anybody has played ---");
{
  // The week is flagged as begun and no score exists yet — the hour before
  // the first kickoff. The header said "0.0 SCORED" over a full roster and
  // every row read 0.0 PTS, which looks like a disaster rather than a Sunday
  // morning. A nought before anything is played is not a score.
  await page.goto(`${BASE}/my-team?nothingplayed=1`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => /PPG|NOT YET RANKED/.test(document.body.innerText), undefined, { timeout: 20000 })
    .catch(() => {});
  const t = await page.locator("body").innerText();

  ok("the header does not claim a score", !/\bSCORED\b/.test(t));
  ok("it offers the projection instead", /PROJECTED/.test(t));

  const headline = t.match(/([\d.]+)\nPROJECTED/)?.[1];
  ok(`and the projection is a real number (${headline})`, Number(headline) > 0);

  // Read off the rows rather than off the page: the header strip says
  // "PTS / GAME" now, and a page-wide search for PTS finds that instead.
  const basis = await page.evaluate(() =>
    [...document.querySelectorAll("[data-basis]")].map((el) => el.getAttribute("data-basis")));
  ok(`the rows are projections too (${[...new Set(basis)].join(", ")})`,
    basis.length > 0 && basis.every((b) => b === "projection"));
  ok("and none of them reads nought",
    !/(^|\n)0\.0(\n|$)/.test(t));

  await page.goto(`${BASE}/my-team`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => /PPG|NOT YET RANKED/.test(document.body.innerText), undefined, { timeout: 20000 })
    .catch(() => {});
  ok("while a week with scores in it still says so",
    /\bSCORED\b/.test(await page.locator("body").innerText()));
}

console.log("\n--- when one man has played and the rest have not ---");
{
  // Thursday night. One player on the roster has scored six; nobody else has
  // taken the field. Best ball fills the slots with whoever is actually
  // scoring, so the roster is worth six — but the header chose its lineup by
  // projection and then summed live points over whoever projection had
  // picked, and the man who played was not among them. It read 0.0.
  await page.goto(`${BASE}/my-team?thursday=1`, { waitUntil: "networkidle" });
  await page
    .waitForFunction(() => /PPG|NOT YET RANKED/.test(document.body.innerText), undefined, { timeout: 20000 })
    .catch(() => {});
  const t = await page.locator("body").innerText();

  ok("it counts the man who played", /6\.0\nSCORED/.test(t));
  ok("rather than nought", !/0\.0\nSCORED/.test(t));
}

console.log("\n--- the reserve ---");
{
  const t = await body();
  ok("a stashed player sits in his own group", /\bIR\b/.test(t));

  // The button that offers the reserve is offered only where the server will
  // take it. Trey McBride is on the report; Christian McCaffrey carries the
  // draft pool's questionable flag and is on no report at all, and used to be
  // exactly the player a browser-side rule would have offered.
  const stashable = await page
    .locator('button[title*="injured reserve"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("title")));
  ok(`only the injured are offered the reserve (${stashable.length})`, stashable.length === 0);

  const back = await page
    .locator('button[title*="back onto your roster"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("title")));
  ok(`and both stashed players offer the way back (${back.length})`, back.length === 2);

  // The demand, not the report: a cleared player is on the books where he
  // sits, so a full roster is now over and nothing can be added until
  // somebody goes.
  ok("a cleared player is named, not merely counted", /Rashee Rice is cleared to play/.test(t));
  ok("and the manager is told to drop somebody", /Drop somebody before you can add anybody/.test(t));
}

console.log("\n--- and every other section renders ---");
for (const [tab, wanted, label] of [
  ["Matchup", /WIN PROBABILITY|PROJECTED|Steel Cartel/i, "a scoreline"],
  ["News", /ALL|INJURY|ROLE|OTHER/, "the filter chips"],
  ["Watch", /Marquez Valdes-Scantling|watchlist/i, "the tracked players"],
  ["Trades", /trade|offer/i, "the desk"],
  ["Edit", /PIN|name|photo/i, "the forms"],
]) {
  await open(tab);
  // Waited for rather than slept on: every section fetches, and a fixed pause
  // long enough on one machine is a coin toss on another.
  const shown = await page
    .waitForFunction((src) => new RegExp(src).test(document.body.innerText),
      wanted.source, { timeout: 15000 })
    .then(() => true)
    .catch(() => false);
  ok(`${tab} shows ${label}`, shown);
  // A section that renders its own heading under a tab already saying the
  // same word was the duplication this redesign was meant to remove.
  ok(`${tab} is in the address, so back works`,
    page.url().includes(`tab=${tab.toLowerCase()}`));
}

console.log("\n--- and the way back ---");
{
  await open("Roster");
  ok("Roster is the bare address", !page.url().includes("tab="));
  await page.goBack();
  await page.waitForTimeout(500);
  ok("the back button steps between sections", page.url().includes("tab=edit"));
}

console.log("\n--- the pencil ---");
{
  await page.goto(`${BASE}/my-team`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  await page.getByRole("button", { name: "Edit team" }).click();
  await page.waitForTimeout(600);
  ok("it opens the Edit section", page.url().includes("tab=edit"));
}

console.log("\n--- how old everybody is ---");
{
  // In a dynasty league a name without an age is half a fact. It has to be on
  // every one of them, not on the ones that happened to get a component.
  await page.goto(`${BASE}/my-team`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  const aged = await page.locator('[aria-label^="Age "]').count();
  const named = await page.locator('a[href^="/player/"]').count();
  // Everybody but the defense, which has no birthday and gets no guess.
  ok(`every footballer on the roster carries one (${aged} of ${named})`, aged === named - 1);

  const dst = await page.locator('a[href*="Ravens"]').first().locator("xpath=..").innerText();
  ok(`and a defense is left blank rather than guessed (${dst.replace(/\n/g, " ")})`,
    !/\b\d\d\b/.test(dst));

  // The real numbers, not a placeholder: two players whose birthdays are in
  // the pool, read off the page rather than off the module.
  const nacua = await page.locator('a[href="/player/Puka%20Nacua"]').first()
    .locator("xpath=..").innerText();
  ok(`and it is his actual age (${nacua.replace(/\n/g, " ")})`, /\b25\b/.test(nacua));

}

console.log("\n--- being told when the app is shut ---");
{
  await page.goto(`${BASE}/my-team/edit`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);

  const opener = page.getByRole("button", { name: /Notify me on this device/ });
  ok("the settings offer notifications", (await opener.count()) === 1);

  await opener.click();
  await page.waitForFunction(() => /Turn on notifications|cannot send notifications/.test(document.body.innerText),
    null, { timeout: 8000 }).catch(() => {});

  const t = await page.locator("body").innerText();

  // Chromium here has no push service, so the panel lands on one of two
  // honest states. Both are real; what must not happen is a dead switch.
  const unsupported = /cannot send notifications/.test(t);
  ok(`it says where it stands (${unsupported ? "unsupported" : "offering"})`,
    unsupported || /Turn on notifications/.test(t));

  if (!unsupported) {
    ok("all four kinds are named", /Scoring updates/.test(t) && /Weekly recap/.test(t)
      && /Injuries/.test(t) && /Weekly projections/.test(t));

    // Each says what it will and will not wake you for, because "Injuries" on
    // its own does not tell somebody whether every questionable tag buzzes.
    ok("and each says what it will actually send", /lead in your matchup changes hands/.test(t)
      && /A doubt is not worth waking you for/.test(t));

    const boxes = page.locator('input[type="checkbox"]');
    ok(`one switch each (${await boxes.count()})`, (await boxes.count()) === 4);
    ok("and nothing is on to begin with",
      (await boxes.evaluateAll((all) => all.every((b) => !b.checked))));

    // A preference is the manager's, not the device's, so it saves whether or
    // not this browser could ever receive one.
    const before = page.locator("body");
    await boxes.nth(1).check();
    await page.waitForTimeout(400);
    ok("a kind can be chosen before the device is signed up",
      await boxes.nth(1).isChecked());
    void before;

    const row = await boxes.nth(1).locator("xpath=..").boundingBox();
    ok(`a thumb can hit a row (${Math.round(row?.height ?? 0)}px)`, (row?.height ?? 0) >= 44);
  }
}

await browser.close();
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
