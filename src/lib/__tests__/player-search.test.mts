/**
 * Which footballers a story is about, and whether it is recent enough to say.
 *
 * Every case here is one the real wire produces. The pool below is small and
 * hand-built so the ambiguity rules can be exercised — two Browns, one Chase,
 * a suffix, an apostrophe, a hyphen and a pair of initials.
 */
import { FRESH_DAYS, buildIndex, foldText, isFresh, playersIn } from "../player-search";

let failed = 0;
const ok = (label: string, cond: boolean) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failed++;
};
const same = (label: string, got: string[], want: string[]) => {
  const g = [...got].sort().join(" | ");
  const w = [...want].sort().join(" | ");
  console.log(`${g === w ? "PASS" : "FAIL"}  ${label}${g === w ? "" : ` — got [${g}] want [${w}]`}`);
  if (g !== w) failed++;
};

const POOL = [
  { n: "Ja'Marr Chase" },
  { n: "Marvin Harrison Jr." },
  { n: "A.J. Brown" },
  { n: "Hollywood Brown" },
  { n: "Jaxon Smith-Njigba" },
  { n: "Puka Nacua" },
  { n: "Jayden Daniels" },
  { n: "Bijan Robinson" },
  { n: "Amon-Ra St. Brown" },
  { n: "Baltimore Ravens D/ST" },
];
const index = buildIndex(POOL);

console.log("--- folding a sentence the way a name is folded ---");
ok("a possessive comes off", foldText("Chase's hamstring") === "chase hamstring");
ok("an apostrophe closes up", foldText("Ja'Marr Chase") === "jamarr chase");
ok("and a curly one does too", foldText("Ja’Marr Chase") === "jamarr chase");
ok("initials close up", foldText("A.J. Brown") === "aj brown");
ok("a full stop after a word is a space", foldText("Brown. He ran") === "brown he ran");
ok("a hyphen is a space", foldText("Smith-Njigba") === "smith njigba");
ok("accents fold", foldText("Amon-Ra St. Brown") === "amon ra st brown");
ok("commas and colons are spaces", foldText("Out: Chase, Nacua") === "out chase nacua");

console.log("\n--- the full name ---");
same("a plain headline", playersIn("Bijan Robinson runs for three", index), ["Bijan Robinson"]);
same("an apostrophe in the name", playersIn("Ja'Marr Chase ruled out", index), ["Ja'Marr Chase"]);
same("spelled without the apostrophe", playersIn("JaMarr Chase ruled out", index), ["Ja'Marr Chase"]);
same("a suffix the writer kept", playersIn("Marvin Harrison Jr. scores", index), ["Marvin Harrison Jr."]);
same("a suffix the writer dropped", playersIn("Marvin Harrison scores", index), ["Marvin Harrison Jr."]);
same("initials with stops", playersIn("A.J. Brown questionable", index), ["A.J. Brown"]);
same("initials without", playersIn("AJ Brown questionable", index), ["A.J. Brown"]);
same("a hyphenated surname", playersIn("Jaxon Smith-Njigba leads the team", index), ["Jaxon Smith-Njigba"]);
same("two men in one story", playersIn("Puka Nacua and Bijan Robinson both cleared", index), ["Puka Nacua", "Bijan Robinson"]);
same("a possessive", playersIn("Jayden Daniels' arm is fine", index), ["Jayden Daniels"]);

console.log("\n--- the surname on its own ---");
same("the only Chase there is", playersIn("Chase questionable for Sunday", index), ["Ja'Marr Chase"]);
same("and the only Nacua", playersIn("Nacua limited in practice", index), ["Puka Nacua"]);
// The whole point of the uniqueness rule: two Browns and neither is named.
same("two Browns means neither", playersIn("Brown is doubtful", index), []);
same("but the full name still picks one", playersIn("Hollywood Brown is doubtful", index), ["Hollywood Brown"]);

console.log("\n--- the surname that is also an ordinary word ---");
// Twenty-nine of these exist in the real pool. Each of them is a headline
// that used to name a footballer who has nothing to do with the story.
const WORDS = buildIndex([
  { n: "Isaiah Likely" },
  { n: "Hunter Long" },
  { n: "D'Andre Swift" },
  { n: "Kareem Hunt" },
  { n: "Ja'Marr Chase" },
]);
same("an adverb is not a tight end", playersIn("Chiefs likely to rest starters", WORDS), []);
same("an adjective is not a tight end", playersIn("A long touchdown run", WORDS), []);
same("nor is an adverb of manner", playersIn("A swift recovery is expected", WORDS), []);
same("nor a noun", playersIn("The hunt for a running back", WORDS), []);
same("nor a verb", playersIn("Bengals chase a division title", WORDS), []);
// And the capital still earns the match where it is a name.
same("but the capital names him", playersIn("Likely leads all tight ends", WORDS), ["Isaiah Likely"]);
same("and so does the full name", playersIn("Isaiah Likely caught two", WORDS), ["Isaiah Likely"]);
same("mid-sentence, capitalised", playersIn("Baltimore says Likely is fine", WORDS), ["Isaiah Likely"]);
// A title-case headline capitalises everything, so a capital means nothing
// and the surname rule stands down rather than guessing.
same("title case earns no surname", playersIn("Chiefs Likely To Rest Starters", WORDS), []);
same("and neither does all caps", playersIn("CHIEFS LIKELY TO REST STARTERS", WORDS), []);
same("a full name survives title case", playersIn("Isaiah Likely Catches Two", WORDS), ["Isaiah Likely"]);

console.log("\n--- what must never match ---");
same("a first name alone", playersIn("Bijan looked good", index), []);
same("another first name alone", playersIn("Jayden threw for 300", index), []);
same("a name inside a longer word", playersIn("Chaser was the horse", index), []);
same("a surname inside a longer word", playersIn("Nacuas everywhere", index), []);
same("nothing at all", playersIn("The league announced a new rule", index), []);
same("empty text", playersIn("", index), []);
// A defense is one token after folding, so it has no surname entry and cannot
// be dragged in by the word "Ravens" in a story about the club.
same("a club is not a player", playersIn("The Ravens signed a kicker", index), []);

console.log("\n--- the index itself ---");
ok("a short surname earns no entry", !index.surname.has("st brown") && !index.surname.has("brown"));
ok("a unique surname does", index.surname.get("chase") === "Ja'Marr Chase");
ok("the suffix is off the full key", index.full.has("marvin harrison"));

console.log("\n--- the two-week window ---");
const now = Date.parse("2026-09-19T12:00:00Z");
const ago = (days: number) => new Date(now - days * 86400_000).toISOString();
ok("today is fresh", isFresh(ago(0), now));
ok("yesterday is fresh", isFresh(ago(1), now));
ok("thirteen days is fresh", isFresh(ago(13), now));
ok("fourteen days is the edge and still counts", isFresh(ago(FRESH_DAYS), now));
ok("fifteen days is not", !isFresh(ago(15), now));
ok("a month is not", !isFresh(ago(30), now));
ok("an undated story is not", !isFresh("", now));
ok("nor an unparseable one", !isFresh("last Tuesday", now));
ok("a few minutes ahead of our clock is allowed", isFresh(new Date(now + 4 * 60_000).toISOString(), now));
ok("but not a story from next week", !isFresh(new Date(now + 7 * 86400_000).toISOString(), now));

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
