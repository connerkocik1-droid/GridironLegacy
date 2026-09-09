/**
 * Check the player pool against the real NFL, and write what is missing.
 *
 * The pool began as a set of exports and drifted, the way a hand-built table
 * always does: by the start of the season it was missing two hundred and
 * eleven men who were on a roster, including starting quarterbacks. A manager
 * cannot draft, claim or even look up a player the pool has never heard of,
 * so a gap here is not a cosmetic problem — it is a player who does not exist
 * as far as the league is concerned.
 *
 * So the pool is no longer maintained by hand. This reads two public sources
 * and prints the difference:
 *
 *   nflverse    — every man on an NFL roster, from the league's own feeds.
 *                 The truth about who is employed.
 *   FantasyPros — consensus redraft rankings, scraped this month. The truth
 *                 about where the market has them.
 *
 * Run `node scripts/roster-sync.mjs` to see the gaps, and
 * `node scripts/roster-sync.mjs --write` to close them: it appends the missing
 * players to src/data/league-data.js and refreshes the roster snapshot that
 * pool-coverage.test.mts checks against.
 *
 * Nothing here invents a statistic. A player the market has no opinion about
 * gets an entry that says so.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WRITE = process.argv.includes("--write");

const ROSTERS = "https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_2026.csv";
const ECR = "https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_fpecr_latest.csv";
// Everybody nflverse has ever had a row for, which is the only place a free
// agent's birthday can come from: he is on nobody's roster, so he is in no
// roster feed.
const PLAYERS = "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv";

/** The positions this league drafts individually. D/ST is a team, not a man. */
const SKILL = new Set(["QB", "RB", "WR", "TE", "K"]);
/**
 * Employed by an NFL club, which is a wider net than "will play on Sunday".
 *
 * ACT is the active roster. RES is injured reserve and EXE the exempt list —
 * both are men under contract who are not available this week. DEV is the
 * practice squad, and leaving it out was a mistake worth naming: a practice
 * squad receiver is one injury from being elevated, and a pool that has never
 * heard of him is a pool where nobody can claim him the Tuesday he matters.
 */
const ON_ROSTER = new Set(["ACT", "RES", "DEV", "EXE"]);

/** Team codes, as each source spells them, mapped to the ones the app uses. */
const TEAM = {
  LA: "LAR", WAS: "WSH",                                     // nflverse
  SFO: "SF", JAC: "JAX", KCC: "KC", LVR: "LV", GBP: "GB",    // FantasyPros
  TBB: "TB", NEP: "NE", NOS: "NO",
};
const team = (t) => TEAM[t] ?? t;

/**
 * The same man, spelled two ways.
 *
 * Every entry here was confirmed by hand: same position, same team, same
 * person. Guessing at this is how a pool ends up with one player twice, so
 * nothing is matched on a resemblance — a name not on this list and not an
 * exact match is treated as somebody new.
 */

export function parseCsv(text) {
  const rows = [];
  let field = "", row = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n") { row.push(field); field = ""; rows.push(row); row = []; }
    else if (c !== "\r") field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  const head = rows.shift();
  return rows.filter((r) => r.length > 3).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

/**
 * A name flattened to the thing two sources can agree on: no accents, no
 * punctuation, no generational suffix. "Ja'Marr Chase" and "JaMarr Chase"
 * land on the same string; "Keon Coleman" and "Kevin Coleman" do not.
 */
export const norm = (s) => s
  .normalize("NFD").replace(/\p{Diacritic}/gu, "")
  .toLowerCase()
  .replace(/[.'’`]/g, "")
  .replace(/-/g, " ")
  .replace(/\b(jr|sr|ii|iii|iv)\b/g, "")
  .replace(/\s+/g, " ")
  .trim();

const ALIAS = new Map();
for (const group of JSON.parse(fs.readFileSync(path.join(ROOT, "src/data/name-aliases.json"), "utf8")).groups) {
  // Every member of a group answers to the first spelling in it.
  const [canonical, ...rest] = group.map(norm);
  for (const other of rest) ALIAS.set(other, canonical);
}

/** The key a pool entry is found under, aliases applied. */
export const key = (name) => { const n = norm(name); return ALIAS.get(n) ?? n; };

async function fetchCsv(url, cache) {
  const file = path.join(ROOT, ".cache", cache);
  if (fs.existsSync(file)) return parseCsv(fs.readFileSync(file, "utf8"));
  process.stderr.write(`fetching ${cache}…\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  const text = await res.text();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  return parseCsv(text);
}

export async function load() {
  const [roster, ecr, everyone] = await Promise.all([
    fetchCsv(ROSTERS, "roster_2026.csv"),
    fetchCsv(ECR, "fpecr.csv"),
    fetchCsv(PLAYERS, "players.csv"),
  ]);

  /**
   * Birthdays for anybody, on a roster or not.
   *
   * This release is every player nflverse has ever had a row for, which is the
   * only place a free agent's birthday lives — and the reason it has to be
   * read carefully. Names repeat across decades: taking the first row for
   * "Justin Watson" made the Chiefs receiver fifty-one, because a different
   * Justin Watson played in the nineties.
   *
   * So a name that appears more than once is only trusted when the rows agree
   * on a birthday. Where they do not, the most recent career wins — and only
   * if nothing else played as recently, because two men of the same name in
   * the same decade is a coin toss and a coin toss is not a fact.
   */
  const seen = new Map();
  for (const r of everyone) {
    const d = r.birth_date ?? "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) continue;
    const k = key(r.display_name ?? "");
    if (!k) continue;
    if (!seen.has(k)) seen.set(k, []);
    seen.get(k).push({ dob: d, last: Number(r.last_season) || 0, position: r.position ?? "" });
  }

  const born = new Map();
  for (const [k, rows] of seen) {
    const dates = new Set(rows.map((r) => r.dob));
    if (dates.size === 1) { born.set(k, rows[0].dob); continue; }

    const latest = Math.max(...rows.map((r) => r.last));
    const leaders = rows.filter((r) => r.last === latest);
    // One clear most-recent career, and the older namesakes are not close
    // enough to be him. Otherwise this name gets no birthday at all.
    if (leaders.length === 1 && rows.every((r) => r.last === latest || latest - r.last >= 5)) {
      born.set(k, leaders[0].dob);
    }
  }
  // What the league feed says about everyone it mentions, on a club or not, so
  // write() can tell a man who was cut from one it simply has no row for.
  const status = new Map();
  for (const r of roster) if (!status.has(key(r.full_name))) status.set(key(r.full_name), r.status);

  const nfl = roster
    .filter((r) => SKILL.has(r.position) && ON_ROSTER.has(r.status))
    .map((r) => ({
      name: r.full_name,
      pos: r.position,
      team: team(r.team),
      depth: r.depth_chart_position,
      exp: Number(r.years_exp) || 0,
      rookieYear: Number(r.rookie_year) || null,
      draftClub: r.draft_club,
      draftPick: Number(r.draft_number) || null,
      college: r.college,
      espnId: r.espn_id || null,
      // The day he was born, which does not drift the way a listed age does.
      born: /^\d{4}-\d{2}-\d{2}$/.test(r.birth_date ?? "") ? r.birth_date : null,
      ir: r.status === "RES",
      squad: r.status === "DEV",
    }));

  // The market, in two slices: where a player sits on the whole board, and
  // where he sits among his own position. Filtered by page rather than by the
  // ecr_type column, which mixes defensive rankings into the same bucket and
  // will cheerfully tell you a linebacker is the second-best pick in football.
  const overall = new Map(), positional = new Map(), byes = {}, owned = new Map();
  for (const r of ecr) {
    const k = key(r.player);
    if (r.page_type === "redraft-overall" && !overall.has(k)) overall.set(k, Number(r.ecr));
    if (/^redraft-(qb|rb|wr|te|k)$/.test(r.page_type) && !positional.has(k)) positional.set(k, Number(r.ecr));
    if (r.bye && r.bye !== "NA") byes[team(r.tm)] = Number(r.bye);
    const own = Number(r.player_owned_avg);
    if (Number.isFinite(own) && !owned.has(k)) owned.set(k, own);
  }
  return { nfl, status, born, overall, positional, byes, owned,
           scraped: ecr[0]?.scrape_date ?? "unknown" };
}

/**
 * Where a 2026 consensus rank sits on the pool's own ADP scale.
 *
 * The two are not the same number. ADP is where a player actually went last
 * time anybody counted; ECR is where a room of analysts says he should go, and
 * it runs longer — past four hundred, where the pool's ADP stops at three
 * hundred and twenty-three. Dropping raw ECR into the ADP column would push
 * every player added here below every player already in the pool, which is a
 * quiet way of saying a starting quarterback is worse than a practice-squad
 * receiver.
 *
 * So the scale is learned rather than assumed: the players who have both a
 * pool ADP and a 2026 ECR are the calibration, and a new player is placed
 * where men the market ranks alongside him actually went. A running median
 * over a window of twenty-one, forced upward so the curve never doubles back.
 */
export function calibrate(pairs) {
  const sorted = [...pairs].sort((a, b) => a.ecr - b.ecr);
  const W = 10;
  const curve = [];
  let ceiling = 0;
  for (let i = 0; i < sorted.length; i++) {
    const window = sorted.slice(Math.max(0, i - W), i + W + 1).map((p) => p.adp).sort((a, b) => a - b);
    const median = window[Math.floor(window.length / 2)];
    ceiling = Math.max(ceiling, median);
    curve.push({ ecr: sorted[i].ecr, adp: ceiling });
  }
  return (ecr) => {
    if (!curve.length) return ecr;
    if (ecr <= curve[0].ecr) return curve[0].adp;
    const last = curve[curve.length - 1];
    // Past the calibration, keep going at the slope the tail was running at
    // rather than flattening — otherwise every unranked player ties.
    if (ecr >= last.ecr) return last.adp + (ecr - last.ecr);
    let lo = 0;
    while (lo < curve.length - 1 && curve[lo + 1].ecr < ecr) lo++;
    const a = curve[lo], b = curve[lo + 1];
    const t = b.ecr === a.ecr ? 0 : (ecr - a.ecr) / (b.ecr - a.ecr);
    return a.adp + t * (b.adp - a.adp);
  };
}

const ORDINAL = (n) => {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

/** What we can say about a man without making anything up. */
function describe(r, market) {
  const bits = [];
  if (r.ir) bits.push("On injured reserve.");
  const where = r.squad ? `${r.team}'s practice squad` : `${r.team}'s roster`;

  if (r.exp === 0) {
    bits.push(
      r.draftPick && r.draftClub
        ? `A rookie, taken ${ORDINAL(r.draftPick)} overall by ${r.draftClub}${r.college ? ` out of ${r.college.split(";")[0].trim()}` : ""}${r.squad ? `, now on ${r.team}'s practice squad` : ""}.`
        : `An undrafted rookie${r.college ? ` out of ${r.college.split(";")[0].trim()}` : ""}, on ${where}.`,
    );
  } else {
    const year = r.exp === 1 ? "second year" : `${ORDINAL(r.exp + 1)} season`;
    bits.push(`In his ${year}, on ${where} at ${r.pos}.`);
  }

  if (market.posRank) {
    bits.push(
      `Consensus ${market.posRank} for 2026${market.owned != null ? `, rostered in ${market.owned}% of leagues` : ""}.`,
    );
  } else {
    bits.push("The consensus rankings have no opinion on him — undrafted in almost every league.");
  }
  return bits.join(" ");
}

/**
 * An archetype has to come from something. These come from the roster sheet
 * and the rankings and nowhere else, because the alternative is inventing a
 * scouting report for a man nobody has written one about.
 */
function archetype(r, market) {
  if (r.pos === "K") return market.posRank ? "Volume Kicker" : "Fringe";
  if (r.exp === 0) return "New-Blood";
  if (!market.posRank) return "Fringe";
  if (r.exp >= 8) return "Veteran";
  return "Stable Starter";
}

export function buildEntry(r, market, byes) {
  const bye = byes[r.team];
  return {
    n: r.name,
    p: r.pos,
    t: r.team,
    arch: archetype(r, market),
    adp: market.adp,
    e: null,
    f: market.overall != null ? Math.round(market.overall) : null,
    s: null,
    rost: market.owned ?? 0,
    // Not set from injured reserve, which was a category error: `q` means the
    // market had a questionable designation on him at the time of the export,
    // and being on IR is neither questionable nor a market opinion. That it
    // was ever true of anybody today is the injury report's business, and the
    // reserve is already said in his own words below.
    q: false,
    marketStat: market.posRank
      ? `${market.posRank} · ROST ${market.owned ?? 0}%`
      : "Undrafted · no consensus rank",
    ins: describe(r, market),
    espnAdp: null,
    fpRank: market.overall != null ? Math.round(market.overall) : null,
    ...(bye != null ? { bye } : {}),
    ...(market.posRank ? { posRank: market.posRank } : {}),
  };
}

/** Everybody on an NFL roster that the pool does not have. */
export function diff(pool, nfl) {
  const have = new Set(pool.map((p) => key(p.n)));
  const missing = nfl.filter((r) => !have.has(key(r.name)));
  const onRoster = new Set(nfl.map((r) => key(r.name)));
  const gone = pool.filter((p) => p.p !== "D/ST" && !onRoster.has(key(p.n)));
  const wrongTeam = [];
  const byKey = new Map(nfl.map((r) => [key(r.name), r]));
  for (const p of pool) {
    const r = byKey.get(key(p.n));
    if (r && r.team !== p.t) wrongTeam.push({ name: p.n, pos: p.p, was: p.t, now: r.team });
  }
  return { missing, gone, wrongTeam };
}

export async function report() {
  const { POOL } = await import(path.join(ROOT, "src/data/league-data.js"));
  const data = await load();
  const { missing, gone, wrongTeam } = diff(POOL, data.nfl);

  const pairs = POOL.filter((p) => data.overall.has(key(p.n)))
    .map((p) => ({ ecr: data.overall.get(key(p.n)), adp: p.adp }));
  const toAdp = calibrate(pairs);

  // The rank a man actually holds at his position in this scrape, counted
  // rather than rounded off his ECR — four receivers can share an ECR that
  // rounds to 70, and three of them would then be told they were WR70.
  const ranks = positionRanks(POOL, data.nfl, data.positional);
  const posRankOf = (r) => ranks.get(key(r.name)) ?? null;

  // Placing a new man on the board.
  //
  // The pool's ADP only means anything down to about the hundred and seventieth
  // pick. Below that it is a sentinel: two hundred and fifty-one players share
  // the value 170 exactly, because that is what the source writes when a player
  // went undrafted. So the calibrated ADP is used where it lands inside the
  // part of the board that is real, and past that the new players are spread
  // across the sparse tail in consensus order instead of being piled onto one
  // number. Ordering is the thing that matters there — nobody is choosing
  // between pick 244 and pick 247, but everybody wants the better player first.
  const REAL = 169.9;                        // where the pool's ADP stops meaning anything
  const [TAIL_FROM, TAIL_TO] = [170.5, 323]; // the sparse tail the pool already has
  const ecrOf = (r) => data.overall.get(key(r.name)) ?? null;
  const posEcrOf = (r) => data.positional.get(key(r.name)) ?? Infinity;

  const placed = new Map();
  const inTail = [], noMarket = [];
  for (const r of missing) {
    const ecr = ecrOf(r);
    if (ecr == null) { noMarket.push(r); continue; }
    const adp = toAdp(ecr);
    if (adp < REAL) placed.set(r, Math.round(adp * 10) / 10);
    else inTail.push(r);
  }
  inTail.sort((a, b) => ecrOf(a) - ecrOf(b) || a.name.localeCompare(b.name));
  inTail.forEach((r, i) => {
    const t = inTail.length === 1 ? 0 : i / (inTail.length - 1);
    placed.set(r, Math.round((TAIL_FROM + t * (TAIL_TO - TAIL_FROM)) * 10) / 10);
  });
  // Nobody has ranked these. They go past the end of the board in the only
  // order left: what the market thinks of them at their own position.
  noMarket.sort((a, b) => posEcrOf(a) - posEcrOf(b) || a.name.localeCompare(b.name));
  const past = Math.max(TAIL_TO, ...POOL.map((p) => p.adp));
  noMarket.forEach((r, i) => placed.set(r, Math.round((past + 1 + i * 0.5) * 10) / 10));

  const built = missing.map((r) => buildEntry(r, {
    overall: ecrOf(r),
    adp: placed.get(r),
    posRank: posRankOf(r),
    owned: data.owned.get(key(r.name)) ?? null,
  }, data.byes));
  built.sort((a, b) => a.adp - b.adp || a.n.localeCompare(b.n));
  return { POOL, data, missing, gone, wrongTeam, built };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { POOL, data, missing, gone, wrongTeam, built } = await report();
  console.log(`pool: ${POOL.length} entries`);
  console.log(`NFL skill players on a 2026 roster: ${data.nfl.length}   (rankings scraped ${data.scraped})`);
  console.log(`MISSING from the pool: ${missing.length}`);
  console.log(`in the pool but on nobody's roster: ${gone.length}`);
  console.log(`in the pool under the wrong team: ${wrongTeam.length}`);
  for (const w of wrongTeam) console.log(`   ${w.name} (${w.pos}) ${w.was} -> ${w.now}`);
  console.log(`\nthe twenty the market rates highest, of the ones we were missing:`);
  for (const b of built.slice(0, 20)) {
    console.log(`   adp ${String(b.adp).padStart(6)}  ${b.n.padEnd(24)} ${b.p.padEnd(4)} ${b.t.padEnd(4)} ${b.posRank ?? "—"}`);
  }
  if (WRITE) {
    const added = write(built, data);
    console.log(`\nwrote ${added} new entries into src/data/league-data.js`);
  }
}

/**
 * A player's rank among his own position, where that can be said cleanly.
 *
 * The pool's existing ranks came from a different scrape, and re-deriving all
 * of them from this one would move a hundred and seventy-seven players and
 * contradict the prose sitting next to them ("Consensus RB15 at an average
 * pick of…" beside a badge reading RB47). So the old ones stand, the new ones
 * take the rank this scrape gives them, and where the two would collide the
 * new player simply goes without — as three hundred and sixty-two players in
 * the pool already do. Every rank in the pool stays unique, which is the part
 * that shows.
 */
function positionRanks(pool, nfl, positional) {
  const pos = new Map();
  for (const p of pool) pos.set(key(p.n), p.p);
  for (const r of nfl) if (!pos.has(key(r.name))) pos.set(key(r.name), r.pos);
  const groups = {};
  for (const [k, ecr] of positional) {
    const p = pos.get(k);
    if (p) (groups[p] ??= []).push({ k, ecr });
  }
  const rank = new Map();
  for (const [p, list] of Object.entries(groups)) {
    list.sort((a, b) => a.ecr - b.ecr).forEach((x, i) => rank.set(x.k, `${p}${i + 1}`));
  }
  return rank;
}

export function write(built, data) {
  const file = path.join(ROOT, "src/data/league-data.js");
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const at = lines.findIndex((l) => l.startsWith("export const POOL = "));
  if (at < 0) throw new Error("cannot find POOL in league-data.js");
  const pool = JSON.parse(lines[at].slice("export const POOL = ".length).replace(/;$/, ""));

  const onRoster = new Map(data.nfl.map((r) => [key(r.name), r]));
  let moved = 0, byed = 0, released = 0;
  for (const p of pool) {
    // A player the pool has on the wrong team is as wrong as one it is
    // missing: his bye is wrong, his stat line is wrong, and a manager
    // planning round nine around him is planning around nothing.
    const r = onRoster.get(key(p.n));
    if (r && r.team !== p.t) { p.t = r.team; delete p.bye; moved++; }
    // A player the pool has at a club he was cut from is a trap rather than a
    // stale row: he sits on the board with a team beside him, somebody spends
    // a pick on him, and he scores nothing all year. Released to free agency,
    // where he is still draftable and no longer pretending.
    if (!r && p.t !== "FA" && p.p !== "D/ST") {
      p.t = "FA";
      delete p.bye;
      released++;
    }
    if (p.bye == null && data.byes[p.t] != null) { p.bye = data.byes[p.t]; byed++; }
  }

  const rank = positionRanks(pool, data.nfl, data.positional);
  const taken = new Set(pool.map((p) => p.posRank).filter(Boolean));
  for (const b of built) {
    const r = rank.get(key(b.n));
    if (r && !taken.has(r)) { b.posRank = r; taken.add(r); }
    else delete b.posRank;
  }

  // Stable: existing entries keep their order among themselves and against a
  // new entry drawn to the same pick.
  const merged = [...pool, ...built].sort((a, b) => a.adp - b.adp);
  lines[at] = `export const POOL = ${JSON.stringify(merged)};`;

  // Everything below reads the feed by name.
  const byName = new Map(data.nfl.map((r) => [key(r.name), r]));

  // Birthdays.
  //
  // The pool carried a listed age for about half its players and nothing for
  // the rest, and a listed age is right on the day it is written and wrong for
  // the rest of the year. The feed carries the date of birth, which does not
  // drift, so that is what is stored — ageOf does the arithmetic on the way
  // out, against today.
  const agesAt = lines.findIndex((l) => l.startsWith("export const AGES = "));
  if (agesAt < 0) throw new Error("cannot find AGES in league-data.js");
  const ages = JSON.parse(lines[agesAt].slice("export const AGES = ".length).replace(/;$/, ""));
  let born = 0;
  for (const p of merged) {
    if (p.p === "D/ST") continue;
    // His own roster row first, then the all-players release, which is the
    // only place a free agent's birthday lives.
    const dob = byName.get(key(p.n))?.born ?? data.born.get(key(p.n)) ?? null;
    if (!dob) continue;
    const held = ages[p.n] ?? {};
    if (held.dob === dob) continue;
    // The listed age is dropped once there is a birthday to work from. Keeping
    // both invites the two to disagree, and only one of them can go stale.
    ages[p.n] = { exp: held.exp ?? byName.get(key(p.n))?.exp ?? 0, dob };
    born++;
  }
  lines[agesAt] = `export const AGES = ${JSON.stringify(ages)};`;
  console.log(`  dates of birth recorded: ${born}`);

  fs.writeFileSync(file, lines.join("\n"));

  // Faces.
  //
  // The pool's own headshots are ESPN CDN URLs keyed by that player's ESPN id,
  // and the roster feed carries the id — so the men this script adds can have
  // the same picture from the same place as the ones already here, rather than
  // a grey silhouette. Four hundred and thirty-eight of nine hundred and
  // forty-four had none, three hundred and fifty-nine of them added by this
  // script, and a roster of blank circles is a roster nobody can read at a
  // glance.
  //
  // The rest are free agents, who are on nobody's roster and so in no feed, and
  // the team defences, which are a crest rather than a face.
  const shotsFile = path.join(ROOT, "src/data/headshots.state.json");
  const shots = JSON.parse(fs.readFileSync(shotsFile, "utf8"));
  let faces = 0;
  for (const p of merged) {
    if (shots[p.n] || p.p === "D/ST") continue;
    const id = byName.get(key(p.n))?.espnId;
    if (!id) continue;
    shots[p.n] = `https://a.espncdn.com/i/headshots/nfl/players/full/${id}.png`;
    faces++;
  }
  fs.writeFileSync(shotsFile, JSON.stringify(shots) + "\n");
  console.log(`  headshots filled in: ${faces}`);

  // The snapshot pool-coverage.test.mts checks against, so the guarantee
  // holds in CI with no network and no CSV.
  const snapshot = data.nfl
    .map((r) => ({ n: r.name, p: r.pos, t: r.team }))
    .sort((a, b) => a.n.localeCompare(b.n));
  fs.writeFileSync(
    path.join(ROOT, "src/data/nfl-rosters-2026.json"),
    JSON.stringify({ source: "nflverse roster_2026 (week 1), active and injured reserve", players: snapshot }, null, 1) + "\n",
  );
  console.log(`  moved to their real team: ${moved}`);
  console.log(`  released to free agency, no longer on a club: ${released}`);
  console.log(`  bye weeks filled in: ${byed}`);
  return built.length;
}
