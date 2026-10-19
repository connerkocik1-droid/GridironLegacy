/**
 * What ESPN's play feed actually looks like, for a real, finished game.
 *
 * The gamecast's LAST PLAY card reads the newest play off the back of this
 * feed, and it was reported frozen a few minutes into the first quarter. Two
 * things in the reader could do that and neither can be checked from a
 * sandbox with no network:
 *
 *   The ordering. fetchPlayByPlay sorts on a sequence string. That is right
 *   while every sequence is padded to one width and wrong at the end when
 *   they are not — "9" sorts above "160", so the last play of the sorted
 *   feed becomes play nine and stays there.
 *
 *   The paging. Pages arrive oldest first, so a reader that stops early drops
 *   the NEWEST plays, which looks exactly like a game that stopped.
 *
 * So this asks ESPN and prints the answer to both. Run it from Actions; it
 * needs no secrets, because everything it reads is public.
 */

const CORE = "https://sports.core.api.espn.com/v2/sports/football/leagues/nfl";
const SITE = "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

const get = async (url) => {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
};

/** A finished game to read. The argument wins; otherwise the last slate's. */
async function pickGame() {
  if (process.argv[2]) return process.argv[2];
  const board = await get(`${SITE}/scoreboard`);
  const done = (board.events ?? []).filter(
    (e) => e.status?.type?.state === "post",
  );
  const pick = done.at(-1) ?? (board.events ?? []).at(-1);
  if (!pick) throw new Error("no games on the current slate — pass an event id");
  return String(pick.id);
}

const id = await pickGame();
console.log(`game ${id}`);

const pages = [];
for (let page = 1; page <= 20; page++) {
  const body = await get(`${CORE}/events/${id}/competitions/${id}/plays?limit=300&page=${page}`);
  const items = body.items ?? [];
  pages.push({ page, count: items.length, pageCount: Number(body.pageCount ?? 1), items });
  if (!items.length || page >= Number(body.pageCount ?? 1)) break;
}

const total = pages.reduce((n, p) => n + p.count, 0);
const pageCount = pages[0]?.pageCount ?? 1;
console.log(`\npaging: ${total} plays over ${pages.length} page(s); ESPN says pageCount ${pageCount}`);
console.log(`        asked for limit=300, got ${pages[0]?.count ?? 0} on page one`);
console.log(pageCount > 12
  ? `  !! pageCount ${pageCount} is past MAX_PAGES — the newest plays are being dropped`
  : "  ok  the reader's page cap is clear of this");

const seqs = pages.flatMap((p) => p.items.map((it) => String(it.sequenceNumber ?? it.id ?? "")));
const widths = [...new Set(seqs.map((s) => s.length))].sort((a, b) => a - b);
console.log(`\nsequences: ${seqs.length} values, width(s) ${widths.join(", ")}`);
console.log(`           first ${seqs.slice(0, 3).join(" ")} … last ${seqs.slice(-3).join(" ")}`);

// The question that matters: do the two comparisons disagree about the end?
const byString = [...seqs].sort((a, b) => a.localeCompare(b));
const byNumber = [...seqs].sort((a, b) => {
  const x = a.replace(/^0+(?=.)/, "");
  const y = b.replace(/^0+(?=.)/, "");
  return x.length !== y.length ? x.length - y.length : x < y ? -1 : x > y ? 1 : 0;
});

const same = byString.at(-1) === byNumber.at(-1);
console.log(`\nlast play by string compare: ${byString.at(-1)}`);
console.log(`last play by numeric compare: ${byNumber.at(-1)}`);
console.log(same
  ? "  ok  the two agree — the padding held, and the sort was not the freeze"
  : "  !! they disagree — the string compare was picking the wrong last play");

if (widths.length > 1) {
  console.log("\n  !! the widths are not uniform, which is what breaks a plain string compare");
}
