/**
 * The other lens: what the browser says while the real routes answer.
 *
 * scripts/mobile/audit.mjs measures geometry with /api/* answered in the
 * browser from a fixture. That is right for measuring a layout, and it means
 * the audit has never once run the routes this app actually ships — so a page
 * that renders a stack trace renders it at both widths and passes, twice.
 *
 * This loads the same list of pages with nothing intercepted, and listens
 * rather than looks. Anything uncaught, and any console error, is a finding.
 *
 * Two exceptions, both deliberate:
 *
 *   Requests to hosts outside the app are reported and not counted. The one
 *   this hits is the ESPN CDN, which several boards fall back to for a team
 *   mark, and which the sandbox this runs in cannot reach at all. A network
 *   this machine does not have is not a fault in the page.
 *
 *   React's development warnings are counted. They are the whole point: the
 *   empty `src` that made the draft room fetch itself sixty times, and the
 *   hydration mismatch the theme script was causing on every load, were both
 *   only ever said here.
 *
 * Known noise: /commissioner/preseason answers 502 wherever ESPN cannot be
 * reached, which is the case in the sandbox this usually runs in and is the
 * route behaving correctly. It is not special-cased — a 502 that stops being
 * that one is worth seeing.
 *
 * With AUDIT_SHOTS set it also keeps a picture of each page. The stub holds
 * an empty league — no rosters, no schedule, nothing drafted — which is not
 * an edge case: it is the state every manager is in on the day they first
 * sign in, and the one state the fixture-driven audit never shows.
 *
 *   ./scripts/audit-mobile.sh --console            # every page
 *   ./scripts/audit-mobile.sh --console /lineup    # or just one
 */
import { mkdirSync } from "node:fs";
import { chromium } from "playwright";
import { PAGES } from "./pages.mjs";
import { sessionCookie } from "./session.mjs";

const BASE = process.env.AUDIT_BASE ?? "http://localhost:3123";
const SHOTS = process.env.AUDIT_SHOTS || "";
const asked = process.argv.slice(2);
const PATHS = asked.length ? asked : PAGES.map(([url]) => url);

const browser = await chromium.launch(
  process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {},
);
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
});
await ctx.addCookies([sessionCookie()]);
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

const page = await ctx.newPage();

let found = [];
let external = 0;

const origin = new URL(BASE).origin;
const ours = (url) => {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
};

const note = (kind, text) => {
  found.push(`[${kind}] ${text.replace(/\s+/g, " ").trim().slice(0, 400)}`);
};

page.on("console", (m) => {
  if (m.type() !== "error" && m.type() !== "warning") return;
  // "Failed to load resource" without the URL is unactionable, and the
  // listeners below say the same thing with the address attached.
  if (m.text().startsWith("Failed to load resource")) return;
  note(m.type(), m.text());
});
page.on("pageerror", (e) => note("uncaught", e.stack ?? String(e)));

// A request that never got an answer. Off-origin ones are counted and not
// held against the page: the only host this reaches for is the ESPN CDN, for
// a team mark, and the sandbox the audit runs in has no route to it.
page.on("requestfailed", (r) => {
  if (!ours(r.url())) return external++;
  // An abort is the app cancelling its own request, not a request that
  // failed — it is what an AbortController in a cleanup is for, and React
  // runs every effect twice in development, so the correct code produces one
  // of these on every mount. Counting it called the draft rehearsal broken.
  if (r.failure()?.errorText === "net::ERR_ABORTED") return;
  note("failed", `${r.failure()?.errorText ?? "request failed"} — ${r.url()}`);
});

// An answer the app's own server did not want to give. Named with its URL,
// because "502" on its own is a puzzle and "502 on /api/preseason" is a fact.
page.on("response", (r) => {
  if (r.status() < 400) return;
  if (!ours(r.url())) return external++;
  note("http", `${r.status()} ${r.url().slice(origin.length)}`);
});

const failures = [];

for (const path of PATHS) {
  found = [];
  external = 0;
  try {
    await page.goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 20000 });
  } catch {
    // Several pages poll forever. Whatever rendered is what gets listened to.
  }
  await page.waitForTimeout(2200);

  // De-duplicated: one bad element repeated down a list is one bug, and sixty
  // identical lines is how a real second finding gets scrolled off the screen.
  if (SHOTS) {
    const name = path.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home";
    await page.screenshot({ path: `${SHOTS}/empty-${name}.png`, fullPage: true });
  }

  const unique = [...new Set(found)];
  const label = `${path}${external ? `  (${external} external request${external === 1 ? "" : "s"} unreachable)` : ""}`;

  if (unique.length) {
    failures.push([path, unique]);
    console.log(`✗ ${label}`);
    for (const line of unique.slice(0, 4)) console.log(`    ${line}`);
    if (unique.length > 4) console.log(`    …and ${unique.length - 4} more`);
  } else {
    console.log(`· ${label}`);
  }
}

await browser.close();

console.log();
if (failures.length) {
  console.log(`${PATHS.length - failures.length}/${PATHS.length} pages quiet — ${failures.length} with something to say`);
  process.exit(1);
}
console.log(`${PATHS.length}/${PATHS.length} pages quiet`);
