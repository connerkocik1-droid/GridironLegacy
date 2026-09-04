/**
 * Does every page still work on a phone?
 *
 * Run it with ./scripts/audit-mobile.sh, which starts what this needs.
 *
 * Four things are measured on every page at two widths, because these are the
 * four ways a layout stops being usable on a phone rather than merely looking
 * tight:
 *
 *   overflow  something sticks out past the screen, so the page drags
 *             sideways and half of it is off the edge
 *   taps      a control too small to hit with a thumb
 *   tiny      text too small to read
 *   squeezed  a column narrowed until its text wraps a word per line
 *
 * 320px is not a nostalgic width. It is where a layout that merely looks tight
 * at 390 actually breaks, and it costs nothing to check both.
 *
 * The fixture is deliberately hostile — twelve franchises, long names, every
 * panel full. An empty four-team league lays out beautifully and proves
 * nothing; that is exactly how the first version of this passed a site whose
 * League page put one word per line.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { routes } from "./fixture.mjs";
import { sessionCookie } from "./session.mjs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3000";
const STUB = process.env.AUDIT_STUB ?? "http://127.0.0.1:54321";
const SHOTS = process.env.AUDIT_SHOTS ?? null;

const PAGES = [
  ["/", "home"],
  ["/activity", "activity"],
  ["/my-team", "my-team"],
  ["/the-league", "the-league"],
  ["/rules", "rules"],
  ["/chat", "chat"],
  ["/my-team/edit", "edit-team"],
  ["/watchlist", "watchlist"],
  ["/player/Puka%20Nacua", "player-profile"],
  ["/lineup", "lineup"],
  ["/matchups", "matchups"],
  ["/standings", "standings"],
  ["/rankings", "rankings"],
  ["/draft", "draft"],
  ["/draft/rehearsal", "rehearsal"],
  ["/draft/mock", "mock-draft"],
  ["/free-agents", "free-agents"],
  ["/trade-builder", "trade-builder"],
  ["/league", "league"],
  ["/news", "news"],
  ["/player-news", "player-news"],
  ["/pickem", "pickem"],
  ["/20-0", "twenty-zero"],
  ["/minigames", "minigames"],
  ["/commissioner", "commissioner"],
  ["/commissioner/preseason", "preseason-check"],
];

const WIDTHS = [320, 390];

/** Runs in the page. Everything it returns is a measurement, not a judgement. */
function measure() {
  const doc = document.documentElement;

  /**
   * Text nobody can read, in whichever theme is on.
   *
   * The layout checks above would pass a page whose every word was the same
   * colour as the card behind it, which is exactly the failure a second theme
   * introduces: a token gets a light value that was fine on black and vanishes
   * on white, and nothing anywhere says so.
   *
   * Three below is the floor, not four and a half. This app has a deliberate
   * scale of quiet text — a bye week, a timestamp, the slot a player fills —
   * and holding all of it to body-copy contrast would flag thirty things that
   * are meant to be quiet and bury the one that is broken.
   *
   * Defined at the top level so both the full measurement and the second-theme
   * pass can call it.
   */
  const worstContrast = () => {
  const channel = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const luminance = ([r, g, b]) =>
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);

  const parse = (v) => {
    const m = /rgba?\(([^)]+)\)/.exec(v || "");
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
  };

  const over = (top, bottom) =>
    top.rgb.map((c, i) => c * top.a + bottom[i] * (1 - top.a));

  // What is actually behind this text: every background between it and the
  // page, composited in the order the browser paints them.
  const groundOf = (el) => {
    const stack = [];
    for (let p = el; p; p = p.parentElement) {
      const bg = parse(getComputedStyle(p).backgroundColor);
      if (bg && bg.a > 0) stack.push(bg);
    }
    let ground = [255, 255, 255];
    for (let i = stack.length - 1; i >= 0; i--) ground = over(stack[i], ground);
    return ground;
  };

  let worst = null;
  for (const el of document.querySelectorAll("*")) {
    if (el.children.length) continue;
    if (el.closest("[aria-hidden='true']")) continue;
    // A disabled control is meant to look unavailable, and the guideline says
    // so: contrast is not required of one. Without this the run is a list of
    // buttons that are correctly greyed out.
    if (el.closest("[disabled], [aria-disabled='true']")) continue;
    const text = (el.textContent ?? "").trim();
    if (text.length < 2) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    const style = getComputedStyle(el);
    if (style.visibility === "hidden" || style.opacity === "0") continue;
    const tag = el.tagName ? el.tagName.toLowerCase() : "";
    if (tag.startsWith("nextjs-")) continue;
    if (el.closest("nextjs-portal, [id='__next-build-watcher']")) continue;

    const fg = parse(style.color);
    if (!fg) continue;
    const ink = over(fg, groundOf(el));
    const ground = groundOf(el);

    const a = luminance(ink) + 0.05;
    const b = luminance(ground) + 0.05;
    const ratio = a > b ? a / b : b / a;

    if (ratio < 3 && (!worst || ratio < worst.ratio)) {
      worst = {
        ratio: Math.round(ratio * 100) / 100,
        text: text.slice(0, 24),
        colour: style.color,
      };
    }
  }
  return worst;
  };


  const limit = doc.clientWidth;

  // Anything that stops its children reaching the edge of the screen: a rail
  // that scrolls sideways on purpose, like the nav bar or the standings table,
  // or a box that simply cuts them off, like the lottery reel.
  // Next's development overlay is not this app. It draws a toast and a button
  // over every page in dev, and while a compile is running it draws "Checking
  // the project for issues" as a 267x18 link — which measured as a tap target
  // too small to press, on twenty-eight pages at once, and turned one slow run
  // into a wall of failures that had nothing to do with the app.
  const isDevChrome = (el) => {
    for (let p = el; p; p = p.parentElement) {
      const tag = p.tagName ? p.tagName.toLowerCase() : "";
      if (tag.startsWith("nextjs-")) return true;
      if (p.id === "__next-build-watcher") return true;
      if (p.getAttributeNames && p.getAttributeNames().some((a) => a.startsWith("data-nextjs"))) {
        return true;
      }
    }
    return false;
  };

  const inClipper = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      const ov = getComputedStyle(p).overflowX;
      if (ov === "auto" || ov === "scroll" || ov === "hidden" || ov === "clip") return true;
    }
    return false;
  };

  // Sticking out past the screen. "Overflow" here means the page drags
  // sideways and half of it is off the edge, so an element that cannot cause
  // that does not count — and one inside a box that clips it cannot. The
  // clipping box is still measured on its own account, so a container that
  // genuinely runs off the screen is caught either way; what this skips is
  // its contents, which is how a carousel is built.
  let worst = null;
  for (const el of document.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.right <= limit + 1) continue;
    if (isDevChrome(el) || inClipper(el)) continue;
    if (!worst || r.right > worst.right) {
      worst = {
        right: Math.round(r.right),
        over: Math.round(r.right - limit),
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || "").slice(0, 24),
        text: (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
      };
    }
  }

  // 44px is Apple's number for a touch target. 32 is the floor below which it
  // is simply a miss, so that is what this refuses to let through.
  const small = [];
  for (const el of document.querySelectorAll("button, a, select, input, [role=button]")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.height >= 32 && r.width >= 32) continue;
    if (isDevChrome(el)) continue;
    // A link inside a sentence is text, not a control.
    if (el.tagName === "A" && el.closest("p")) continue;
    // A checkbox in a label is pressed by pressing the label; the box is only
    // its marker, and the label is the target that matters.
    if (el.tagName === "INPUT" && el.closest("label")) continue;
    small.push(
      `${el.tagName.toLowerCase()} ${Math.round(r.width)}×${Math.round(r.height)} "${(el.textContent ?? "").trim().slice(0, 16)}"`,
    );
  }

  const tiny = [];
  for (const el of document.querySelectorAll("*")) {
    if (el.children.length) continue;
    const t = (el.textContent ?? "").trim();
    if (t.length < 3) continue;
    if (isDevChrome(el)) continue;
    const size = parseFloat(getComputedStyle(el).fontSize);
    if (size && size < 10) tiny.push(`${size}px "${t.slice(0, 20)}"`);
  }

  // Tall and narrow means the text inside is wrapping a word — or a letter —
  // per line, which measures as "fits" and reads as broken.
  const squeezed = [];
  for (const el of document.querySelectorAll("*")) {
    if (el.children.length) continue;
    const t = (el.textContent ?? "").trim();
    if (t.length < 6) continue;
    const r = el.getBoundingClientRect();
    if (isDevChrome(el)) continue;
    if (r.width > 0 && r.width < 26 && r.height > 40) {
      squeezed.push(`${Math.round(r.width)}px wide "${t.slice(0, 18)}"`);
    }
  }

  return {
    contrast: worstContrast(),
    overflow: doc.scrollWidth - doc.clientWidth,
    worst,
    small: [...new Set(small)].slice(0, 5),
    smallCount: new Set(small).size,
    tiny: [...new Set(tiny)].slice(0, 3),
    tinyCount: new Set(tiny).size,
    squeezed: [...new Set(squeezed)].slice(0, 3),
  };
}

const launch = {};
if (process.env.PLAYWRIGHT_CHROMIUM) launch.executablePath = process.env.PLAYWRIGHT_CHROMIUM;
const browser = await chromium.launch(launch);

if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const findings = [];

for (const width of WIDTHS) {
  const ctx = await browser.newContext({
    viewport: { width, height: 844 },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  });
  await ctx.addCookies([sessionCookie()]);

  for (const [url, name] of PAGES) {
    const page = await ctx.newPage();
    routes(page);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
    try {
      await page.goto(`${BASE}${url}`, { waitUntil: "networkidle", timeout: 20000 });
    } catch {
      // Several pages poll forever and never go idle. Measure what rendered.
    }
    await page.waitForTimeout(1100);

    // Both themes, each one asked for by name.
    //
    // Not left to the browser: Playwright's contexts are light by default, so
    // the app resolved to light and the run measured the same theme twice and
    // called one of them dark. The stylesheet reads one attribute, so setting
    // it is the whole switch — and flipping in place rather than reloading
    // keeps a second load per page off the run.
    const inTheme = async (theme) => {
      await page.evaluate((t) => {
        // Both, and in that order. The attribute is what the stylesheet reads;
        // the stored choice is what the script in the head reads, and that
        // script runs again on its own schedule. Setting only the attribute
        // gets it put back a few milliseconds later, which is how this pass
        // first reported a page half in one theme and half in the other.
        try {
          localStorage.setItem("pylon:theme", t);
        } catch {
          // Then the attribute alone will have to do.
        }
        document.documentElement.dataset.theme = t;
      }, theme);

      // Let the colours arrive. Controls in this app carry a transition, so
      // reading straight after the flip catches every one of them at the
      // instant it is still the theme being left — which is how this pass
      // first reported dark text on a white card and called it a contrast
      // failure.
      await page.waitForTimeout(400);
      return page.evaluate(measure);
    };

    const report = await inTheme("dark");
    report.lightContrast = (await inTheme("light")).contrast;

    findings.push([width, name, url, report, errors]);
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${width}-${name}.png`, fullPage: true });
    await page.close();
  }
  await ctx.close();
}

// The signed-out home page is the sign-up screen — the first thing eleven
// managers ever load, and on a phone. The stub signs everybody in by default,
// so without asking it to stop, this page is never measured at all.
for (const width of WIDTHS) {
  await fetch(`${STUB}/__state`, {
    method: "POST",
    body: JSON.stringify({ authed: false }),
  }).catch(() => {});

  const ctx = await browser.newContext({
    viewport: { width, height: 844 }, hasTouch: true, isMobile: true,
  });
  const page = await ctx.newPage();
  // Signed out in the browser as well as on the server. Without this the page
  // renders the sign-in screen while every client component on it still
  // believes a manager is present.
  routes(page, { signedOut: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
  try {
    await page.goto(`${BASE}/`, { waitUntil: "networkidle", timeout: 20000 });
  } catch {
    // As above: measure what rendered.
  }
  await page.waitForTimeout(900);
  findings.push([width, "signed-out", "/ (signed out)", await page.evaluate(measure), errors]);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${width}-signed-out.png`, fullPage: true });
  await ctx.close();
}

await fetch(`${STUB}/__state`, {
  method: "POST",
  body: JSON.stringify({ authed: true }),
}).catch(() => {});

// The mock draft shows a start screen until you press start, so loading the
// page alone never measures the board anybody actually uses.
for (const width of WIDTHS) {
  const ctx = await browser.newContext({
    viewport: { width, height: 844 }, hasTouch: true, isMobile: true,
  });
  await ctx.addCookies([sessionCookie()]);
  const page = await ctx.newPage();
  routes(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
  try {
    await page.goto(`${BASE}/draft/mock`, { waitUntil: "networkidle", timeout: 20000 });
    await page.getByRole("button", { name: "Start the mock" }).click();
    await page.waitForTimeout(1600);
    findings.push([width, "mock-running", "/draft/mock (started)", await page.evaluate(measure), errors]);
  } catch {
    // If the button is not there the page changed shape; say so rather than
    // quietly reporting a pass for something never measured.
    findings.push([width, "mock-running", "/draft/mock (started)", {
      overflow: 0, worst: null, small: [], smallCount: 0, tiny: [], tinyCount: 0, squeezed: [],
    }, ["could not start the mock draft — has the start button been renamed?"]]);
  }
  await ctx.close();
}

// Draft night has three screens and the audit only ever saw one of them. The
// lobby and the lottery exist for a few minutes once a year, in front of the
// whole league at the same moment, on twelve phones — which is the worst
// possible time to discover that the reel runs off the side of a 320px screen.
for (const width of WIDTHS) {
  for (const [state, name] of [
    ["lobby", "draft-lobby"],
    ["lottery", "draft-lottery"],
  ]) {
    const ctx = await browser.newContext({
      viewport: { width, height: 844 }, hasTouch: true, isMobile: true,
    });
    await ctx.addCookies([sessionCookie()]);
    const page = await ctx.newPage();
    // Nine seconds in: past the lead-in, several names already out, and one
    // still spinning — every part of the screen on at once.
    routes(page, {
      draftState: state,
      lotteryAt: new Date(Date.now() - 9_000).toISOString(),
    });
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
    try {
      await page.goto(`${BASE}/draft`, { waitUntil: "domcontentloaded", timeout: 20000 });
    } catch {
      // As above: measure what rendered.
    }
    await page.waitForTimeout(1400);
    findings.push([width, name, `/draft (${state})`, await page.evaluate(measure), errors]);
    await ctx.close();
  }
}

// The home page before the league has drafted. Every other case here is a
// league in mid-season, and this one is what the other eleven managers see on
// the day they first sign in: no schedule, no scores, and draft night still to
// come. It is a different page and it was never measured.
for (const width of WIDTHS) {
  const ctx = await browser.newContext({
    viewport: { width, height: 844 }, hasTouch: true, isMobile: true,
  });
  await ctx.addCookies([sessionCookie()]);
  const page = await ctx.newPage();
  routes(page, { preseason: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
  try {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
  } catch {
    // As above: measure what rendered.
  }
  await page.waitForTimeout(1200);
  findings.push([width, "home-preseason", "/ (before the draft)", await page.evaluate(measure), errors]);
  await ctx.close();
}

// The add-to-home-screen hint is the one piece of interface that renders for
// nobody in this browser: it shows only in mobile Safari, to somebody who has
// not already installed the app. Without pretending to be an iPhone, the audit
// would report a clean home page while the widest thing on it went unmeasured.
const IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";

for (const width of WIDTHS) {
  const ctx = await browser.newContext({
    viewport: { width, height: 844 },
    userAgent: IOS_SAFARI,
    hasTouch: true,
    isMobile: true,
  });
  await ctx.addCookies([sessionCookie()]);
  const page = await ctx.newPage();
  routes(page);
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e).slice(0, 120)));
  try {
    await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
  } catch {
    // As above: measure what rendered.
  }
  await page.waitForTimeout(1200);

  // Waited for rather than sampled at an instant. It renders in an effect
  // after hydration, so on a run where the server is still compiling it was
  // simply not there yet — and the audit called that a regression.
  const shown = await page
    .getByText("Put this on your home screen")
    .waitFor({ state: "attached", timeout: 5000 })
    .then(() => 1)
    .catch(() => 0);
  findings.push([
    width,
    "a2hs-hint",
    "/ (iOS Safari)",
    await page.evaluate(measure),
    // A hint that has stopped appearing is a silent regression: the app would
    // simply never get onto anybody's home screen again, and every page would
    // still measure clean.
    shown ? errors : [...errors, "the add-to-home-screen hint did not appear in mobile Safari"],
  ]);
  await ctx.close();
}

for (const width of WIDTHS) {
  console.log(`\n════ ${width}px ════`);
  console.log("page            scroll  worst overflow                    taps  tiny");
  console.log("──────────────  ──────  ────────────────────────────────  ────  ────");
  for (const [w, name, , r] of findings) {
    if (w !== width) continue;
    const off = r.worst ? `${r.worst.tag} +${r.worst.over}px "${r.worst.text.slice(0, 18)}"` : "—";
    console.log(
      name.padEnd(14) +
        String(r.overflow).padStart(5) + "px  " +
        off.padEnd(32) +
        String(r.smallCount).padStart(4) +
        String(r.tinyCount).padStart(6),
    );
  }
}

const bad = ([, , , r, errors]) =>
  r.overflow > 1 || r.worst || r.smallCount > 0 || r.tinyCount > 0 ||
  r.squeezed.length > 0 || r.contrast || r.lightContrast || errors.length > 0;

const failures = findings.filter(bad);

if (failures.length) {
  console.log("\n──── detail ────");
  for (const [w, name, url, r, errors] of failures) {
    console.log(`\n${name} (${url}) @ ${w}px`);
    if (r.overflow > 1) console.log(`  page scrolls sideways by ${r.overflow}px`);
    if (r.worst) {
      console.log(`  overflow: ${r.worst.tag}.${r.worst.cls} +${r.worst.over}px — "${r.worst.text}"`);
    }
    if (r.small.length) console.log(`  small taps (${r.smallCount}): ${r.small.join(", ")}`);
    if (r.tiny.length) console.log(`  tiny text (${r.tinyCount}): ${r.tiny.join(", ")}`);
    if (r.squeezed.length) console.log(`  squeezed: ${r.squeezed.join(", ")}`);
    for (const [theme, c] of [["dark", r.contrast], ["light", r.lightContrast]]) {
      if (c) {
        console.log(`  ${theme}: ${c.ratio}:1 on "${c.text}" (${c.colour})`);
      }
    }
    if (errors.length) console.log(`  page errors: ${errors.join(" | ")}`);
  }
}

console.log(`\n${findings.length - failures.length}/${findings.length} page-widths clean`);
if (SHOTS) console.log(`screenshots in ${SHOTS}`);

await browser.close();
process.exitCode = failures.length ? 1 : 0;
