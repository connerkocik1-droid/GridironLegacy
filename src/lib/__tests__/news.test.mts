import { fetchNews, timeAgo } from "../news";

let failed = 0;
const ok = (label: string, cond: boolean) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failed++;
};

// A response shaped like ESPN's, including the fields we depend on.
const SAMPLE = {
  articles: [
    {
      id: 4567,
      headline: "Chase questionable for Sunday",
      description: "The receiver was limited in practice.",
      published: new Date(Date.now() - 3600_000).toISOString(),
      byline: "Field Yates",
      links: { web: { href: "https://espn.com/story/1" } },
      images: [{ url: "https://a.espncdn.com/1.jpg" }],
      categories: [
        { type: "athlete", athlete: { displayName: "Ja'Marr Chase" } },
        { type: "team", team: { displayName: "Bengals" } },
        { type: "athlete", athlete: { displayName: "Tee Higgins" } },
      ],
    },
    // A sparse article: every optional field missing but the date, which is
    // now load-bearing — an undated item is dropped, so one without a date
    // could no longer stand in for "everything else is missing".
    { headline: "Bare story", published: new Date(Date.now() - 7200_000).toISOString() },
    // Out of the window. Six weeks ago was a designation that either became
    // an absence everybody knows about or stopped being true.
    {
      id: 9001,
      headline: "Puka Nacua signs extension",
      published: new Date(Date.now() - 42 * 86400_000).toISOString(),
    },
    // No date at all: an undated item sorts to the top of a feed ordered by
    // date and stays there forever, so it is dropped.
    { id: 9002, headline: "Bijan Robinson rushes for 100" },
  ],
};

globalThis.fetch = (async () => ({ ok: true, json: async () => SAMPLE })) as never;
const stories = await fetchNews();

ok("keeps the two stories inside the window", stories.length === 2);
ok("keeps the headline", stories[0].headline === "Chase questionable for Sunday");
ok("keeps the link", stories[0].link === "https://espn.com/story/1");

// The athlete tags ESPN sent, plus the men the text actually names. "Chase"
// in the headline is Ja'Marr Chase whether or not ESPN said so, and this
// fixture is the case where it did.
ok("keeps ESPN's athlete tags", stories[0].players.includes("Tee Higgins"));
ok("and names the man in the headline", stories[0].players.includes("Ja'Marr Chase"));
ok("without listing him twice", stories[0].players.filter((p) => p === "Ja'Marr Chase").length === 1);
ok("and nobody else", stories[0].players.length === 2);

ok("a sparse article still parses", stories[1].headline === "Bare story");
ok("and gets safe defaults", stories[1].link === null && stories[1].players.length === 0);
ok("an article with no id still gets one", Boolean(stories[1].id));

// The window, at the seam where it matters: both of these name a real pool
// player, so only the date can be keeping them out.
ok("six weeks ago is gone", !stories.some((s) => s.headline.includes("Puka Nacua")));
ok("and an undated story is gone", !stories.some((s) => s.headline.includes("Bijan Robinson")));
ok("newest first", Date.parse(stories[0].published) >= Date.parse(stories[1].published));

// Failure paths: a bad status, a thrown fetch, and malformed JSON must all
// return an empty list rather than throwing into the page.
globalThis.fetch = (async () => ({ ok: false, json: async () => ({}) })) as never;
ok("a non-200 returns nothing", (await fetchNews()).length === 0);

globalThis.fetch = (async () => { throw new Error("network"); }) as never;
ok("a network failure returns nothing", (await fetchNews()).length === 0);

globalThis.fetch = (async () => ({ ok: true, json: async () => ({ nope: 1 }) })) as never;
ok("unexpected JSON returns nothing", (await fetchNews()).length === 0);

ok("timeAgo reads hours", timeAgo(new Date(Date.now() - 7200_000).toISOString()) === "2h ago");
ok("timeAgo reads minutes", timeAgo(new Date(Date.now() - 300_000).toISOString()) === "5m ago");
ok("timeAgo survives junk", timeAgo("not-a-date") === "");
ok("timeAgo survives empty", timeAgo("") === "");

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
