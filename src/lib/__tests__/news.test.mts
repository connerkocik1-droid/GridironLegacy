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
    // A sparse article: every optional field missing.
    { headline: "Bare story" },
  ],
};

globalThis.fetch = (async () => ({ ok: true, json: async () => SAMPLE })) as never;
const stories = await fetchNews();

ok("parses both articles", stories.length === 2);
ok("keeps the headline", stories[0].headline === "Chase questionable for Sunday");
ok("keeps the link", stories[0].link === "https://espn.com/story/1");
ok("pulls only athlete categories", JSON.stringify(stories[0].players) === JSON.stringify(["Ja'Marr Chase", "Tee Higgins"]));
ok("a sparse article still parses", stories[1].headline === "Bare story");
ok("and gets safe defaults", stories[1].link === null && stories[1].players.length === 0);
ok("an article with no id still gets one", Boolean(stories[1].id));

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
