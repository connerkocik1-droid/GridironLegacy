import { existsSync } from "node:fs";
import { cfbLogo, cfbSchool } from "../cfb-logos";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!pass) failed++;
};

console.log("--- every school the league's boards have named ---");
// Every spelling the published Top 25s have used, and every abbreviation on
// the Pylon 50, as they are in the database.
const names = [
  "Alabama", "Boise State", "BYU", "Florida", "Florida State", "Georgia", "Houston", "Indiana", "Iowa",
  "Kentucky", "Louisville", "LSU", "Miami", "Michigan", "Miss St.", "Mississippi State", "Missouri",
  "Mizzouri", "Northwestern", "Notre Dame", "Ohio State", "Oklahoma St.", "Oklahoma State", "Ole Miss",
  "Oregon", "Penn St.", "Penn State", "SMU", "Tennessee", "Texas", "Texas A&M", "Texas Tech", "UCLA",
  "USC", "Utah", "Wake Forest",
];
const missing = names.filter((n) => !cfbLogo(null, n));
eq("each has a crest", missing, []);
const abbrs = ["OU", "MIA", "BAMA", "VT", "MICH", "MSST", "IOWA", "IND", "UNC", "ND", "UF", "OKST", "USC", "BYU",
  "MIZZ", "OSU", "UGA", "BGSU", "MISS", "TEX", "SCAR", "MINN", "ORE", "LSU"];
eq("and each Pylon 50 school", abbrs.filter((a) => !cfbLogo(a)), []);

console.log("\n--- the spellings ---");
eq("an abbreviated name is the same school", cfbSchool("Oklahoma St.")?.abbr, "OKST");
eq("so is a typo the board has carried", cfbSchool("Mizzouri")?.abbr, "MIZZ");
eq("Miami is the Hurricanes", cfbSchool("Miami")?.abbr, "MIA");
eq("Ole Miss is not Mississippi State", [cfbSchool("Ole Miss")?.abbr, cfbSchool("Miss St.")?.abbr], ["MISS", "MSST"]);
eq("Ohio State and Oklahoma State are told apart", [cfbSchool("OSU")?.name, cfbSchool("OKST")?.name], ["Ohio State", "Oklahoma State"]);
eq("an abbreviation in lower case still counts", cfbSchool("bama")?.name, "Alabama");
eq("a school it does not carry is nothing, not a guess", cfbSchool("Sacramento State"), null);
eq("a typed abbreviation it doesn't know falls back to the name", cfbLogo("XYZ", "Texas Tech"), "/assets/logos/cfb/ttu.png");

console.log("\n--- the files ---");
const all = [...names, ...abbrs].map((n) => cfbSchool(n)!.logo);
eq("every crest it names is in public/", all.filter((src) => !existsSync(`public${src}`)), []);

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
