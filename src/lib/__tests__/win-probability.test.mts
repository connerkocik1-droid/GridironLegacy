import { asPercents, outlookOf, winProbability, type Playable } from "../win-probability";

let failed = 0;
const ok = (label: string, got: boolean) => {
  console.log(`${got ? "PASS" : "FAIL"}  ${label}`);
  if (!got) failed++;
};
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}`}`);
  if (!pass) failed++;
};
const near = (label: string, got: number, want: number, tol = 0.02) => {
  const pass = Math.abs(got - want) <= tol;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${got.toFixed(3)}, wanted ~${want}`}`);
  if (!pass) failed++;
};

const p = (points: number, projected: number, state: "pre" | "in" | "post"): Playable =>
  ({ points, projected, state });

console.log("--- where a side stands ---");
{
  const side = outlookOf([p(0, 15, "pre"), p(0, 12, "pre"), p(0, 10, "pre")]);
  eq("nothing played means nothing banked", side.scored, 0);
  eq("and everything still to come", side.remaining, 37);
  eq("nine players yet to play is nine", side.yetToPlay, 3);
  eq("with nobody on the field", side.inPlay, 0);
}
{
  const side = outlookOf([p(22, 15, "post"), p(0, 12, "pre")]);
  eq("a finished player is banked at what he scored", side.scored, 22);
  eq("not at what he was projected", side.remaining, 12);
  eq("and he is not still to play", side.yetToPlay, 1);
}
{
  // The case that makes a naive model lie. He has beaten his projection, and
  // "projection minus points" would hand the side negative points to come.
  const side = outlookOf([p(18, 12, "in")]);
  eq("a man mid-game banks what he has", side.scored, 18);
  eq("and has nothing left to come once he is past his projection", side.remaining, 0);
  eq("he counts as in play", [side.inPlay, side.yetToPlay], [1, 0]);
}
{
  const side = outlookOf([p(4, 14, "in")]);
  eq("mid-game and behind his projection, the rest is still coming", side.remaining, 10);
  eq("banked at four", side.scored, 4);
}
{
  eq("an empty slot is not a player", outlookOf([null, p(0, 10, "pre")]).yetToPlay, 1);
}

console.log("\n--- the chance of winning ---");
{
  const even = outlookOf([p(0, 100, "pre")]);
  near("two identical sides are a coin toss", winProbability(even, even), 0.5);
}
{
  const home = outlookOf([p(0, 120, "pre")]);
  const away = outlookOf([p(0, 100, "pre")]);
  const w = winProbability(home, away);
  ok(`a better projection is favoured (${(w * 100).toFixed(0)}%)`, w > 0.5);
  ok("but it is nowhere near certain before anybody plays", w < 0.75);
}
{
  // The exact case ScoreBar refuses to answer, and the reason this file
  // exists: a share-of-points bar reads 100% here.
  //
  // Both sides project to a hundred. One of them has simply got there first,
  // and a lead that is only the clock is not a lead at all.
  const home = outlookOf([p(40, 40, "post"), p(0, 60, "pre")]);
  const away = outlookOf([p(0, 40, "pre"), p(0, 60, "pre")]);
  const w = winProbability(home, away);
  near("40-0 against a side that has not played is still a coin toss", w, 0.5);
}
{
  // Being ahead of the pace is the thing that counts, not being ahead.
  const fast = outlookOf([p(40, 20, "post"), p(0, 60, "pre")]);   // 20 to the good
  const slow = outlookOf([p(0, 20, "pre"), p(0, 60, "pre")]);
  const w = winProbability(fast, slow);
  ok(`beating a projection by twenty is a real lead (${(w * 100).toFixed(0)}%)`, w > 0.6);
  ok("and still not a win with sixty points left to play", w < 0.95);
}
{
  // Same lead, nothing left to play. Now it really is over.
  const home = outlookOf([p(40, 40, "post")]);
  const away = outlookOf([p(20, 40, "post")]);
  eq("a lead with nobody left to play is a win", winProbability(home, away), 1);
  eq("and from the other side, a loss", winProbability(away, home), 0);
}
{
  const level = outlookOf([p(30, 30, "post")]);
  eq("level with nobody left is a coin toss", winProbability(level, level), 0.5);
}
{
  const home = outlookOf([p(90, 90, "post")]);
  const away = outlookOf([p(120, 120, "post")]);
  eq("a graded week is simply who won", winProbability(home, away, true), 0);
  eq("whatever the projections said", winProbability(away, home, true), 1);
}
{
  // Certainty hardens as the day goes on: the same twenty-point lead is
  // worth more at five o'clock than at one.
  const early = winProbability(
    outlookOf([p(20, 20, "post"), p(0, 100, "pre")]),
    outlookOf([p(0, 100, "pre")]),
  );
  const late = winProbability(
    outlookOf([p(20, 20, "post"), p(100, 100, "post"), p(0, 10, "pre")]),
    outlookOf([p(100, 100, "post"), p(0, 10, "pre")]),
  );
  ok(`the same lead is safer later (${(early * 100).toFixed(0)}% then ${(late * 100).toFixed(0)}%)`,
    late > early);
}
{
  const behind = winProbability(outlookOf([p(0, 80, "pre")]), outlookOf([p(0, 120, "pre")]));
  ok("the underdog is under half", behind < 0.5);
  ok("but never written off before kickoff", behind > 0.05);
}

console.log("\n--- and what the card shows ---");
{
  eq("the two percentages add to a hundred", asPercents(0.5), { home: 50, away: 50 });
  eq("even when the rounding is awkward", asPercents(0.455), { home: 46, away: 54 });
  const sum = [0.001, 0.337, 0.5, 0.666, 0.999].map((x) => {
    const { home, away } = asPercents(x);
    return home + away;
  });
  eq("always, for any probability", sum, [100, 100, 100, 100, 100]);
  eq("a certainty reads as a certainty", asPercents(1), { home: 100, away: 0 });
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
if (failed) process.exitCode = 1;
