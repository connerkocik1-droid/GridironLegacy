/**
 * Does the wire actually carry news about this league's footballers?
 *
 *   node scripts/verify-news.mjs
 *
 * Run it from a network that can reach ESPN. It answers the question the
 * feature exists for — "how many of my men does the wire mention this
 * fortnight" — with a number, rather than with an opinion.
 *
 * Three things, in order:
 *
 *   1. How many articles the wire returns, and how many survive the two-week
 *      window. The limit was raised from 40 to 100 and ESPN caps it somewhere;
 *      this says where.
 *   2. How many of those name somebody in the pool, and how many distinct
 *      players get a mention. This is the number that decides whether a
 *      manager opening My Team sees anything at all.
 *   3. Whether the per-athlete feed exists. ESPN's athlete ids are already in
 *      the app — headshots.state.json embeds one per player in the URL — so if
 *      one of these endpoints answers, every player can have his own news
 *      instead of only the ones the league-wide wire happened to write about.
 *      Nothing in the app reads these yet; this is here to find out whether
 *      they are worth reading.
 *
 * It does not fail on a small number. A quiet fortnight in June is a real
 * answer, and so is a busy one in October — the point is to know which.
 */
import { readFileSync } from "node:fs";

const SITE =
  process.env.ESPN_API_BASE ?? "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

const FRESH_DAYS = 14;

// Imported by reading rather than by importing: league-data.js is an ESM
// module full of app imports, and this script wants the names and nothing
// else. The pool is a single JSON array literal on one line.
const source = readFileSync(new URL("../src/data/league-data.js", import.meta.url), "utf8");
const poolLine = source.match(/^export const POOL = (\[.*\]);$/m);
if (!poolLine) {
  console.error("Could not find POOL in src/data/league-data.js — has it been reformatted?");
  process.exit(1);
}
const pool = JSON.parse(poolLine[1]);

const headshots = JSON.parse(
  readFileSync(new URL("../src/data/headshots.state.json", import.meta.url), "utf8"),
);

/** The same folding src/lib/player-search.ts does, kept in step by hand. */
function fold(text) {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/'s\b/g, "")
    .replace(/'/g, "")
    .replace(/\b([a-z])\./g, "$1")
    .replace(/-/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);
function key(name) {
  const parts = fold(name).split(" ");
  while (parts.length > 1 && SUFFIXES.has(parts[parts.length - 1])) parts.pop();
  return parts.join(" ");
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

// ------------------------------------------------------------------- the wire
console.log(`reading ${SITE}/news?limit=100 …`);
const wire = await getJson(`${SITE}/news?limit=100`);
const articles = wire.articles ?? [];

const now = Date.now();
const fresh = articles.filter((a) => {
  const at = Date.parse(a.published ?? "");
  return Number.isFinite(at) && now - at <= FRESH_DAYS * 86400_000;
});

console.log(`\n  ${articles.length} articles returned (asked for 100)`);
console.log(`  ${fresh.length} of them inside ${FRESH_DAYS} days`);
if (articles.length) {
  const dates = articles.map((a) => a.published).filter(Boolean).sort();
  console.log(`  oldest ${dates[0]}\n  newest ${dates[dates.length - 1]}`);
}
if (articles.length < 100) {
  console.log(`  → ESPN caps this endpoint at ${articles.length}. src/lib/news.ts asks for 100.`);
}

// ---------------------------------------------------------------- the matching
const full = new Map();
for (const p of pool) full.set(key(p.n), p.n);

const tagged = new Set();
const named = new Set();
let withTag = 0;
let withName = 0;

for (const a of fresh) {
  const text = ` ${fold(`${a.headline ?? ""} ${a.description ?? ""}`)} `;

  const tags = (a.categories ?? [])
    .filter((c) => c.type === "athlete" && c.athlete?.displayName)
    .map((c) => c.athlete.displayName);
  if (tags.length) withTag++;
  for (const t of tags) if (full.has(key(t))) tagged.add(full.get(key(t)));

  let hit = false;
  for (const [k, name] of full) {
    if (text.includes(` ${k} `)) {
      named.add(name);
      hit = true;
    }
  }
  if (hit) withName++;
}

console.log(`\n  of the ${fresh.length} fresh articles:`);
console.log(`    ${withTag} carry an ESPN athlete tag       -> ${tagged.size} pool players`);
console.log(`    ${withName} name a pool player in the text -> ${named.size} pool players`);
console.log(`\n  (the second line is what the app now reads; the first is what it read before)`);
console.log(
  "  It is a floor: this counts full names only, while the app also accepts a\n" +
  "  capitalised surname that is unique in the pool — \"Chase questionable\".",
);

// ------------------------------------------------------------- per-athlete news
// One known id, pulled out of the headshot URL the app already ships.
const sample = Object.entries(headshots).find(([, url]) => /\/(\d+)\.png/.test(url));
if (!sample) {
  console.log("\nNo headshot with an ESPN id in it — skipping the per-athlete check.");
  process.exit(0);
}
const [sampleName, sampleUrl] = sample;
const id = sampleUrl.match(/\/(\d+)\.png/)[1];

// A second athlete, so the filter can be caught ignoring its argument. An
// endpoint that returns the same fifty articles whatever id you hand it is
// not a per-athlete feed, and "20 articles" from it means nothing.
const other = Object.entries(headshots).find(
  ([n, url]) => n !== sampleName && /\/(\d+)\.png/.test(url),
);
const otherId = other ? other[1].match(/\/(\d+)\.png/)[1] : null;

console.log(`\nlooking for a per-athlete feed, using ${sampleName} (id ${id}) …`);

const shapes = [];
for (const url of [
  `${SITE}/athletes/${id}/news?limit=20`,
  `${SITE}/news?limit=20&athlete=${id}`,
  `https://site.web.api.espn.com/apis/common/v3/sports/football/nfl/athletes/${id}/news?limit=20`,
]) {
  try {
    const body = await getJson(url);
    const found = body.articles ?? body.items ?? [];
    console.log(`  OK    ${found.length} article(s)  ${url}`);
    if (found[0]) console.log(`          e.g. "${found[0].headline ?? found[0].title ?? "?"}"`);
    if (found.length) shapes.push({ url, found });
  } catch (err) {
    console.log(`  none  ${err.message}  ${url}`);
  }
}

// ------------------------------------------------- is the filter real?
// Two tests, and an endpoint has to pass both. Returning articles is not
// enough: the league-wide wire also returns articles, and a "per-athlete"
// feed that quietly ignores the id would hand every player the same fifty
// stories — which is the exact complaint this whole change exists to fix,
// rebuilt more expensively.
for (const { url, found } of shapes) {
  console.log(`\n  testing ${url}`);

  const ids = found.map((a) => String(a.id ?? a.headline)).join(",");
  const wireIds = articles.slice(0, found.length).map((a) => String(a.id ?? a.headline)).join(",");
  console.log(`    same as the league-wide wire? ${ids === wireIds ? "YES — the id is being ignored" : "no"}`);

  if (otherId) {
    try {
      const body = await getJson(url.replace(id, otherId));
      const theirs = (body.articles ?? body.items ?? [])
        .map((a) => String(a.id ?? a.headline)).join(",");
      console.log(`    same for a different athlete?  ${theirs === ids ? "YES — the id is being ignored" : "no"}`);
    } catch {
      console.log("    same for a different athlete?  could not fetch the second one");
    }
  }

  // And the one that actually matters: does he turn up in his own feed?
  const his = key(sampleName);
  const naming = found.filter((a) => ` ${fold(`${a.headline ?? ""} ${a.description ?? ""}`)} `.includes(` ${his} `));
  console.log(`    ${naming.length} of ${found.length} actually name ${sampleName}`);
  if (naming[0]) console.log(`      e.g. "${naming[0].headline}"`);
}

console.log(
  "\nAn endpoint is worth reading only if it says \"no\" to both ignored-id" +
  "\nquestions. One that returns the league-wide wire under a player's name is" +
  "\nworse than no per-player feed at all.",
);
