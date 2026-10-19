/**
 * A club's abbreviation, from however the Pylon Report spelled it.
 *
 * The report's boards carry a team as a name — "San Francisco 49ers" — and the
 * app's logos are keyed by abbreviation. Joining the two is the whole of this
 * file, and the join has to survive the sheet.
 *
 * Matched on the nickname rather than the city, which is the one decision here
 * worth explaining. The sheet is typed by hand and has already shipped
 * "Cincinatti Bengals" once; cities are long and get misspelled, nicknames are
 * short and do not. All thirty-two nicknames happen to be unique across the
 * league, so the last word is enough on its own — and when a city is wrong the
 * nickname still lands.
 *
 * Two clubs need more than a last word. "Football Team" was a name for two
 * seasons and could still be pasted from an old sheet, and both New York and
 * Los Angeles clubs share a city rather than a nickname, which this does not
 * care about at all.
 */

/** Nickname, lowercased, to the abbreviation the logo index uses. */
const BY_NICKNAME: Record<string, string> = {
  cardinals: "ari",
  falcons: "atl",
  ravens: "bal",
  bills: "buf",
  panthers: "car",
  bears: "chi",
  bengals: "cin",
  browns: "cle",
  cowboys: "dal",
  broncos: "den",
  lions: "det",
  packers: "gb",
  texans: "hou",
  colts: "ind",
  jaguars: "jax",
  chiefs: "kc",
  raiders: "lv",
  chargers: "lac",
  rams: "lar",
  dolphins: "mia",
  vikings: "min",
  patriots: "ne",
  saints: "no",
  giants: "nyg",
  jets: "nyj",
  eagles: "phi",
  steelers: "pit",
  "49ers": "sf",
  seahawks: "sea",
  buccaneers: "tb",
  titans: "ten",
  commanders: "wsh",
};

/** Spellings that are not a nickname, or are an old one. */
const ALIASES: Record<string, string> = {
  "football team": "wsh",
  redskins: "wsh",
  niners: "sf",
  bucs: "tb",
  "washington commanders": "wsh",
};

/**
 * "San Francisco 49ers" -> "sf". Empty when nothing matches, which is the
 * answer for every college team and for anything the sheet invented.
 */
export function clubAbbrev(team: string): string {
  const clean = String(team ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";

  if (ALIASES[clean]) return ALIASES[clean];

  const words = clean.split(" ");
  const last = words[words.length - 1];
  if (BY_NICKNAME[last]) return BY_NICKNAME[last];

  // "Football Team" is two words, and so is anything else that ends up here.
  const lastTwo = words.slice(-2).join(" ");
  return ALIASES[lastTwo] ?? "";
}

/**
 * The letters to draw when there is no mark.
 *
 * Every college team lands here, because the app ships thirty-two NFL logos
 * and no college ones. A monogram in the same square tile is not a substitute
 * for the real mark — it is what keeps the two boards looking like one board
 * until somebody supplies the artwork.
 */
export function monogram(team: string): string {
  // Words that start with a letter, so "San Francisco 49ers" is SF rather than
  // SF4 — the number is part of the name and is not an initial.
  const words = String(team ?? "").trim().split(/\s+/).filter((w) => /^[A-Za-z]/.test(w));
  if (words.length >= 2) return words.slice(0, 3).map((w) => w[0].toUpperCase()).join("");
  return (words[0] ?? String(team ?? "")).slice(0, 3).toUpperCase() || "?";
}
