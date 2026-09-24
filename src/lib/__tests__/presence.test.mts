/**
 * Who is here, and when the ones who are not were last about.
 *
 * The window is the interesting part of the first question: five minutes is
 * long enough to cover reading a page and short enough that "here" means here,
 * and both pages that draw a dot have to agree about it or the League tab and
 * the home page argue about who is online.
 *
 * The second question is a formatter, and formatters go wrong at the edges:
 * the minute either side of a boundary, the singular, and a clock that is
 * behind the server's and would otherwise report a negative duration.
 */

import { isPresent, lastActive, PRESENT_MS } from "../presence.ts";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!pass) failed++;
};

const NOW = Date.parse("2026-09-24T18:00:00.000Z");
const ago = (mins: number) => new Date(NOW - mins * 60_000).toISOString();

console.log("--- is anybody here ---");
eq("somebody who just loaded a page", isPresent(ago(0), NOW), true);
eq("and somebody four minutes in", isPresent(ago(4), NOW), true);
eq("but not six", isPresent(ago(6), NOW), false);
eq("the window is five minutes", PRESENT_MS, 5 * 60_000);
eq("nobody at all is not here", isPresent(null, NOW), false);
eq("and neither is nonsense", isPresent("not a date", NOW), false);

console.log("\n--- and when the rest were last about ---");
eq("no stamp is not a duration", lastActive(null, NOW), null);
eq("nor is nonsense", lastActive("whenever", NOW), null);

// A clock behind the server's would otherwise read "-3m".
eq("a stamp from the future reads as now", lastActive(ago(-3), NOW)?.short, "now");

eq("minutes", lastActive(ago(12), NOW), { short: "12m", long: "Last active 12 minutes ago" });
eq("one minute is singular", lastActive(ago(1), NOW), { short: "1m", long: "Last active 1 minute ago" });
eq("hours", lastActive(ago(60 * 3), NOW), { short: "3h", long: "Last active 3 hours ago" });
eq("one hour is singular", lastActive(ago(60), NOW), { short: "1h", long: "Last active 1 hour ago" });
eq("days", lastActive(ago(60 * 24 * 2), NOW), { short: "2d", long: "Last active 2 days ago" });
eq("one day is singular", lastActive(ago(60 * 24), NOW), { short: "1d", long: "Last active 1 day ago" });

// Past a week a duration stops being readable: nobody converts 23d in their head.
const old = lastActive(ago(60 * 24 * 23), NOW);
eq("past a week it is a date, not a count", /\d/.test(old?.short ?? "") && !/^\d+d$/.test(old?.short ?? ""), true);
eq("and the long form says the same date", old?.long, `Last active ${old?.short}`);

// The boundaries themselves, where a rounding error shows up as "60m".
eq("fifty-nine minutes is still minutes", lastActive(ago(59), NOW)?.short, "59m");
eq("and sixty is an hour", lastActive(ago(60), NOW)?.short, "1h");
eq("twenty-three hours is still hours", lastActive(ago(60 * 23), NOW)?.short, "23h");
eq("and twenty-four is a day", lastActive(ago(60 * 24), NOW)?.short, "1d");

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
