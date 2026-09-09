import { POOL } from "../../data/league-data";
import {
  DEFAULT_CAPS,
  capBlock,
  capSummary,
  fullAt,
  heldAt,
  positionCaps,
} from "../draft-caps";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}`}`);
  if (!pass) failed++;
};

/** Real names out of the real pool, so the position lookup is the real one. */
function some(position: string, n: number): string[] {
  const found = POOL.filter((p) => p.p === position).slice(0, n).map((p) => p.n);
  if (found.length < n) throw new Error(`the pool has fewer than ${n} at ${position}`);
  return found;
}

const QBS = some("QB", 5);
const RBS = some("RB", 9);
const DSTS = some("D/ST", 3);
const KS = some("K", 3);

console.log("--- what a league caps ---");
{
  eq("nothing said means the app's own rule", positionCaps(null), DEFAULT_CAPS);
  eq("four quarterbacks", positionCaps(null).QB, 4);
  eq("two defences and two kickers", [positionCaps(null)["D/ST"], positionCaps(null).K], [2, 2]);
  eq("and the skill positions are not capped at all",
    [positionCaps(null).RB, positionCaps(null).WR, positionCaps(null).TE],
    [undefined, undefined, undefined]);
}
{
  // A stored map wins outright. Merging over the defaults would put back a cap
  // the commissioner had just removed.
  const league = { positionCaps: { QB: 2 } };
  eq("a league's own map replaces the default", positionCaps(league), { QB: 2 });
  eq("so a cap it does not mention is gone", positionCaps(league).K, undefined);
}
{
  eq("an empty map is a league with no caps", positionCaps({ positionCaps: {} }), {});
  eq("nought is a real cap", positionCaps({ positionCaps: { K: 0 } }).K, 0);
  eq("nonsense is dropped rather than guessed",
    positionCaps({ positionCaps: { QB: "lots", K: -1, "D/ST": 2 } }), { "D/ST": 2 });
}

console.log("\n--- counting a roster ---");
{
  eq("nobody held", heldAt([], "QB"), 0);
  eq("three quarterbacks", heldAt([...QBS.slice(0, 3), ...RBS.slice(0, 4)], "QB"), 3);
  eq("a name the pool never heard of counts against nothing",
    heldAt(["Somebody Nobody Drafted"], "QB"), 0);
}

console.log("\n--- the rule at the draft ---");
{
  eq("a first quarterback is fine", capBlock([], "QB", null), null);
  eq("and so is a fourth", capBlock(QBS.slice(0, 3), "QB", null), null);
  eq("a fifth is not",
    capBlock(QBS.slice(0, 4), "QB", null),
    "You already have 4 QBs — the limit is 4.");
  eq("a third defence is not",
    capBlock(DSTS.slice(0, 2), "D/ST", null),
    "You already have 2 D/STs — the limit is 2.");
  eq("a third kicker is not",
    capBlock(KS.slice(0, 2), "K", null),
    "You already have 2 Ks — the limit is 2.");
}
{
  // The whole point of the exemption: a hoarded shelf that does not run out.
  eq("a ninth running back is allowed", capBlock(RBS, "RB", null), null);
  eq("and the cap does not care what else is on the roster",
    capBlock([...RBS, ...QBS.slice(0, 1)], "QB", null), null);
}
{
  eq("a position nobody can name is never blocked", capBlock(QBS, null, null), null);
  eq("nor is one the league does not cap",
    capBlock(QBS.slice(0, 4), "QB", { positionCaps: { K: 1 } }), null);
  eq("a cap of nought says so in its own words",
    capBlock([], "K", { positionCaps: { K: 0 } }),
    "No K may be drafted in this league.");
  eq("one held against a limit of one reads as one",
    capBlock(KS.slice(0, 1), "K", { positionCaps: { K: 1 } }),
    "You already have 1 K — the limit is 1.");
}

console.log("\n--- marking a whole list at once ---");
{
  eq("nothing full on an empty roster", [...fullAt([], null)], []);
  eq("full at quarterback only", [...fullAt(QBS.slice(0, 4), null)], ["QB"]);
  eq("full at all three",
    [...fullAt([...QBS.slice(0, 4), ...DSTS.slice(0, 2), ...KS.slice(0, 2)], null)].sort(),
    ["D/ST", "K", "QB"]);
  eq("and never at a position with no cap", fullAt(RBS, null).has("RB"), false);
}

console.log("\n--- what the rules page says ---");
{
  eq("the league's caps, in order", capSummary(null), "4 QB · 2 D/ST · 2 K");
  eq("a league that caps nothing says nothing", capSummary({ positionCaps: {} }), null);
  eq("and one that caps one thing says one thing",
    capSummary({ positionCaps: { TE: 3 } }), "3 TE");
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exit(1);
