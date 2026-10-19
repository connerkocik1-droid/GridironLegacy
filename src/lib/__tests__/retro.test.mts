/**
 * Sixteen-bit mode's two pure pieces: the generated marks, and when the
 * touchdown fanfare fires.
 *
 * The marks matter because the handoff's promise is identity — a team keeps
 * the same hue and shape in both skins — and that only holds if both
 * generators read the same seed the same way. The fanfare matters because the
 * rule is narrow on purpose: your players, a real jump, live.
 */
import { initialsOf, rng, spriteFor, teamHue, teamLogo, teamLogoPx } from "../team-logo";
import { biggestJump, fanfareText, FANFARE_MIN } from "../retro-cues";

let failed = 0;
const ok = (label: string, cond: boolean, note = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${cond || !note ? "" : ` — ${note}`}`);
  if (!cond) failed++;
};

const svgOf = (bg: string) => decodeURIComponent(bg.slice('url("data:image/svg+xml,'.length, -2));

console.log("--- the seed ---");
{
  const a = rng("logoBlaze Syndicate");
  const b = rng("logoBlaze Syndicate");
  ok("the same key draws the same sequence", a() === b() && a() === b());
  ok("a different key draws a different one", rng("logoA")() !== rng("logoB")());
  const r = rng("x");
  const draws = Array.from({ length: 200 }, () => r());
  ok("every draw is in [0, 1)", draws.every((d) => d >= 0 && d < 1));
}

console.log("\n--- initials ---");
ok("two words", initialsOf("Blaze Syndicate") === "BS", initialsOf("Blaze Syndicate"));
ok("three words take the first two", initialsOf("Apex Union FC") === "AU");
ok("one word", initialsOf("Titanfall") === "T");
ok("nothing", initialsOf("") === "?");

console.log("\n--- both skins, one identity ---");
{
  const team = "Blaze Syndicate";
  const modern = teamLogo(team);
  const px = teamLogoPx(team);
  ok("modern is a CSS url()", modern.startsWith('url("data:image/svg+xml,'));
  ok("and so is the pixel one", px.startsWith('url("data:image/svg+xml,'));
  ok("they are not the same drawing", modern !== px);
  ok("the same team is the same mark every time", teamLogo(team) === modern && teamLogoPx(team) === px);
  ok("another team is another mark", teamLogo("Apex Union") !== modern);

  const h = teamHue(team);
  ok(`the modern mark is in the team's hue (${h})`, svgOf(modern).includes(` ${h})`));
  ok("and so is the pixel mark", svgOf(px).includes(`hsl(${h},`));

  const grid = svgOf(px);
  ok("the pixel mark is a 16x16 grid", grid.includes('viewBox="0 0 16 16"'));
  ok("drawn with hard edges", grid.includes('shape-rendering="crispEdges"'));
  const xs = [...grid.matchAll(/<rect x="(\d+)" y="(\d+)"/g)].map((m) => [+m[1], +m[2]]);
  ok("nothing falls off the grid", xs.every(([x, y]) => x >= 0 && x < 16 && y >= 0 && y < 16));
  ok("it has an ink outline", grid.includes("#050a26"));
  ok("and cream initials", grid.includes("#f4efd8"));
  ok("the initials are escaped", !svgOf(teamLogo("A&B Club")).includes("&B"));
}

console.log("\n--- the GameCast runner ---");
{
  const s = svgOf(spriteFor("BUF"));
  ok("two 12x12 frames side by side", s.includes('viewBox="0 0 24 12"'));
  ok("in the club's hue", s.includes(`hsl(${teamHue("BUF")},`));
  ok("both frames are drawn", /<rect x="1[2-9]|<rect x="2[0-3]/.test(s));
}

console.log("\n--- the fanfare ---");
{
  const before = [
    { name: "Bijan Robinson", points: 8, live: true },
    { name: "Ja'Marr Chase", points: 4, live: true },
    { name: "Lamar Jackson", points: 10, live: true },
  ];
  ok("a first reading is not a jump", biggestJump(null, before) === null);

  const touchdown = before.map((r) => (r.name === "Bijan Robinson" ? { ...r, points: 14.1 } : r));
  const jump = biggestJump(before, touchdown);
  ok("a six-point play fires", jump?.name === "Bijan Robinson", JSON.stringify(jump));
  ok("and the banner says who and how much", jump ? fanfareText(jump) === "Bijan Robinson +6.1" : false,
    jump ? fanfareText(jump) : "");

  const yards = before.map((r) => (r.name === "Ja'Marr Chase" ? { ...r, points: 4 + FANFARE_MIN - 0.1 } : r));
  ok("a few yards do not", biggestJump(before, yards) === null);

  const exactly = before.map((r) => (r.name === "Ja'Marr Chase" ? { ...r, points: 4 + FANFARE_MIN } : r));
  ok("three points exactly does", biggestJump(before, exactly)?.name === "Ja'Marr Chase");

  const correction = before.map((r) => (r.name === "Lamar Jackson" ? { ...r, points: 2 } : r));
  ok("a stat correction taking points away does not", biggestJump(before, correction) === null);

  const two = before.map((r) =>
    r.name === "Bijan Robinson" ? { ...r, points: 12 } : r.name === "Lamar Jackson" ? { ...r, points: 16 } : r);
  ok("of two plays, the bigger one wins", biggestJump(before, two)?.name === "Lamar Jackson");

  const finished = touchdown.map((r) => ({ ...r, live: false }));
  ok("a player not in a live game does not", biggestJump(before, finished) === null);

  const newcomer = [...before, { name: "Zay Flowers", points: 9, live: true }];
  ok("a player with no prior reading does not", biggestJump(before, newcomer) === null);
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("\nall passed");
