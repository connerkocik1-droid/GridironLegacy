import { keyOf } from "./pylon-report";

/**
 * College football's crests, bundled with the app the way the NFL's are, so a
 * school on the Top 25 or the Pylon 50 shows its logo without the commissioner
 * uploading one. An upload still wins: this is only what is drawn when there
 * isn't one.
 *
 * The Power Four, Notre Dame, and the Group of Five programs most likely to
 * be ranked. The files are public/assets/logos/cfb/<abbr>.png, from
 * github.com/klunn91/team-logos (MIT).
 *
 * A board names a school however the commissioner typed it — "Oklahoma St.",
 * "Miss St.", "Mizzou" — and the Pylon 50 by abbreviation, so a school is found
 * by its name, any of its other spellings, or any of its abbreviations.
 */
const SCHOOLS: { abbr: string; name: string; also?: string[] }[] = [
  // SEC
  { abbr: "BAMA", name: "Alabama", also: ["ALA"] },
  { abbr: "ARK", name: "Arkansas" },
  { abbr: "AUB", name: "Auburn" },
  { abbr: "UF", name: "Florida", also: ["FLA"] },
  { abbr: "UGA", name: "Georgia" },
  { abbr: "UK", name: "Kentucky" },
  { abbr: "LSU", name: "LSU" },
  { abbr: "MISS", name: "Ole Miss", also: ["Mississippi"] },
  { abbr: "MSST", name: "Mississippi State", also: ["Miss St", "Miss State", "Mississippi St"] },
  { abbr: "MIZZ", name: "Missouri", also: ["Mizzou", "Mizzouri", "MIZ"] },
  { abbr: "OU", name: "Oklahoma", also: ["OKLA"] },
  { abbr: "SCAR", name: "South Carolina", also: ["SC"] },
  { abbr: "TENN", name: "Tennessee" },
  { abbr: "TEX", name: "Texas" },
  { abbr: "TAMU", name: "Texas A&M", also: ["Texas AM", "A&M"] },
  { abbr: "VAN", name: "Vanderbilt", also: ["Vandy"] },
  // Big Ten
  { abbr: "ILL", name: "Illinois" },
  { abbr: "IND", name: "Indiana", also: ["IU"] },
  { abbr: "IOWA", name: "Iowa" },
  { abbr: "MD", name: "Maryland" },
  { abbr: "MICH", name: "Michigan" },
  { abbr: "MSU", name: "Michigan State", also: ["Michigan St", "Mich St"] },
  { abbr: "MINN", name: "Minnesota" },
  { abbr: "NEB", name: "Nebraska" },
  { abbr: "NW", name: "Northwestern" },
  { abbr: "OSU", name: "Ohio State", also: ["Ohio St"] },
  { abbr: "ORE", name: "Oregon" },
  { abbr: "PSU", name: "Penn State", also: ["Penn St"] },
  { abbr: "PUR", name: "Purdue" },
  { abbr: "RUTG", name: "Rutgers", also: ["RU"] },
  { abbr: "UCLA", name: "UCLA" },
  { abbr: "USC", name: "USC", also: ["Southern California"] },
  { abbr: "WASH", name: "Washington", also: ["UW"] },
  { abbr: "WIS", name: "Wisconsin", also: ["WISC"] },
  // Big 12
  { abbr: "ARIZ", name: "Arizona" },
  { abbr: "ASU", name: "Arizona State", also: ["Arizona St"] },
  { abbr: "BAY", name: "Baylor" },
  { abbr: "BYU", name: "BYU" },
  { abbr: "UCF", name: "UCF" },
  { abbr: "CIN", name: "Cincinnati" },
  { abbr: "COLO", name: "Colorado" },
  { abbr: "HOU", name: "Houston" },
  { abbr: "ISU", name: "Iowa State", also: ["Iowa St"] },
  { abbr: "KU", name: "Kansas" },
  { abbr: "KSU", name: "Kansas State", also: ["Kansas St", "K-State"] },
  { abbr: "OKST", name: "Oklahoma State", also: ["Oklahoma St", "OK State"] },
  { abbr: "TCU", name: "TCU" },
  { abbr: "TTU", name: "Texas Tech" },
  { abbr: "UTAH", name: "Utah" },
  { abbr: "WVU", name: "West Virginia" },
  // ACC
  { abbr: "BC", name: "Boston College" },
  { abbr: "CAL", name: "California", also: ["Cal"] },
  { abbr: "CLEM", name: "Clemson" },
  { abbr: "DUKE", name: "Duke" },
  { abbr: "FSU", name: "Florida State", also: ["Florida St"] },
  { abbr: "GT", name: "Georgia Tech" },
  { abbr: "LOU", name: "Louisville" },
  { abbr: "MIA", name: "Miami", also: ["Miami FL", "Miami (FL)", "Miami Florida"] },
  { abbr: "UNC", name: "North Carolina" },
  { abbr: "NCST", name: "NC State", also: ["North Carolina State"] },
  { abbr: "PITT", name: "Pittsburgh", also: ["Pitt"] },
  { abbr: "SMU", name: "SMU" },
  { abbr: "STAN", name: "Stanford" },
  { abbr: "SYR", name: "Syracuse" },
  { abbr: "UVA", name: "Virginia" },
  { abbr: "VT", name: "Virginia Tech" },
  { abbr: "WAKE", name: "Wake Forest" },
  // Independent, and the Group of Five
  { abbr: "ND", name: "Notre Dame" },
  { abbr: "BOIS", name: "Boise State", also: ["Boise St", "BSU"] },
  { abbr: "BGSU", name: "Bowling Green" },
  { abbr: "MEM", name: "Memphis" },
  { abbr: "TUL", name: "Tulane" },
  { abbr: "UNLV", name: "UNLV" },
  { abbr: "ARMY", name: "Army" },
  { abbr: "NAVY", name: "Navy" },
  { abbr: "JMU", name: "James Madison" },
  { abbr: "LIB", name: "Liberty" },
  { abbr: "TOL", name: "Toledo" },
  { abbr: "APP", name: "App State", also: ["Appalachian State", "Appalachian St"] },
  { abbr: "FRES", name: "Fresno State", also: ["Fresno St"] },
  { abbr: "SDSU", name: "San Diego State", also: ["San Diego St"] },
];

export interface CfbSchool {
  abbr: string;
  name: string;
  logo: string;
}

const byAbbr = new Map<string, CfbSchool>();
const byName = new Map<string, CfbSchool>();
for (const s of SCHOOLS) {
  const school = { abbr: s.abbr, name: s.name, logo: `/assets/logos/cfb/${s.abbr.toLowerCase()}.png` };
  byAbbr.set(s.abbr, school);
  byName.set(keyOf(s.name), school);
  for (const other of s.also ?? []) {
    if (/^[A-Z]{2,4}$/.test(other)) byAbbr.set(other, school);
    else byName.set(keyOf(other), school);
  }
}

/** A school from its name, another spelling of it, or its abbreviation. */
export function cfbSchool(nameOrAbbr: string | null | undefined): CfbSchool | null {
  if (!nameOrAbbr) return null;
  return byAbbr.get(nameOrAbbr.trim().toUpperCase()) ?? byName.get(keyOf(nameOrAbbr)) ?? null;
}

/** The bundled crest for a school, by abbreviation first and then by name. */
export function cfbLogo(abbr: string | null | undefined, team?: string | null): string | undefined {
  return (cfbSchool(abbr) ?? cfbSchool(team))?.logo;
}
