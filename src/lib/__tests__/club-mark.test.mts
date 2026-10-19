/**
 * Joining the report's team names to the app's logos.
 *
 * Every case here is a spelling the sheet has produced or plausibly will. The
 * one that matters most is the misspelt city: that is not hypothetical, the
 * first published board said "Cincinatti".
 */
import { existsSync } from "node:fs";
import { clubAbbrev, monogram } from "../club-mark";
import { logo, LOGOS } from "../../data/league-data.js";

let failed = 0;
const eq = (label: string, got: string, want: string) => {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${ok ? "" : ` — got "${got}" want "${want}"`}`);
  if (!ok) failed++;
};

console.log("--- the thirty-two ---");
eq("a plain club", clubAbbrev("San Francisco 49ers"), "sf");
eq("one with a two-word city", clubAbbrev("New York Giants"), "nyg");
eq("and its neighbour", clubAbbrev("New York Jets"), "nyj");
eq("two clubs in one city are told apart by nickname",
  clubAbbrev("Los Angeles Chargers"), "lac");
eq("and so is the other", clubAbbrev("Los Angeles Rams"), "lar");
eq("a nickname that is a number", clubAbbrev("49ers"), "sf");

console.log("\n--- the sheet, as it is actually typed ---");
// The whole reason this matches on the nickname. A city is long and gets
// misspelled; a nickname is short and does not.
eq("a misspelt city still lands", clubAbbrev("Cincinatti Bengals"), "cin");
eq("and a badly misspelt one", clubAbbrev("Philidelphia Eagles"), "phi");
eq("a trailing space", clubAbbrev("Green Bay Packers "), "gb");
eq("lower case", clubAbbrev("green bay packers"), "gb");
eq("a nickname on its own", clubAbbrev("Ravens"), "bal");
eq("a name nobody uses any more", clubAbbrev("Washington Football Team"), "wsh");

console.log("\n--- what has no mark ---");
// Every college team. The app ships thirty-two NFL logos and no college ones,
// so this returning nothing is the normal case rather than the failure case.
eq("a college team", clubAbbrev("Georgia"), "");
eq("another", clubAbbrev("Ohio State"), "");
eq("one whose last word is not a nickname", clubAbbrev("Texas A&M"), "");
eq("nothing at all", clubAbbrev(""), "");
eq("whitespace", clubAbbrev("   "), "");

console.log("\n--- the letters drawn instead ---");
eq("two words give two initials", monogram("Ohio State"), "OS");
eq("three words give three", monogram("Texas A and M"), "TAA");
// The number is part of the name, not an initial: SF, never SF4.
eq("a numeric word is stepped over", monogram("San Francisco 49ers"), "SF");
eq("one word gives three letters", monogram("Georgia"), "GEO");
eq("an acronym survives whole", monogram("LSU"), "LSU");
eq("and nothing gives a question", monogram(""), "?");

console.log("\n--- the marks themselves ---");
// The gamecast's header draws these at thirty pixels, which is the first place
// in the app where a missing file is the whole tile rather than a gap beside a
// name. logo() falls back to ESPN's CDN for anything it does not hold, so a
// renamed asset does not fail here — it silently starts costing a request to
// somebody else's server on every game. So the file is checked, not the string.
{
  // This helper compares strings, so the failures are joined into one: a list
  // of the clubs that are wrong reads better than a count anyway.
  const abbrevs = Object.keys(LOGOS);
  eq("all thirty-two clubs are held", String(abbrevs.length), "32");

  const missing = abbrevs.filter((a) => !existsSync(new URL(`../../../public${logo(a)}`, import.meta.url)));
  eq("and every one of them is a file on disk", missing.join(","), "");

  const remote = abbrevs.filter((a) => !logo(a).startsWith("/assets/logos/"));
  eq("so none of them reaches for the CDN", remote.join(","), "");

  // The one ESPN spells differently from everybody else.
  eq("Washington answers to ESPN's spelling too", logo("WAS"), logo("WSH"));
  // And the non-club that used to be requested 404 times a page.
  eq("a free agent has no mark", logo("FA"), "");
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
