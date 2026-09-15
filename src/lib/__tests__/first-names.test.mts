import { firstNames } from "../first-names";

let failed = 0;
const ok = (label: string, cond: boolean) => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failed++;
};

console.log("--- the ordinary case ---");
{
  const out = firstNames(["Conner Kocik", "Dana Whitfield", "Sam"]);
  ok("a full name comes back as its first", out[0] === "Conner");
  ok("and so does the next", out[1] === "Dana");
  ok("a single name is left alone", out[2] === "Sam");
}

console.log("\n--- two of the same name ---");
{
  const out = firstNames(["Dana Whitfield", "Dana Kowalczyk"]);
  ok("the first takes its initial", out[0] === "Dana W.");
  ok("the second takes its own", out[1] === "Dana K.");
  ok("and they are not the same chip", out[0] !== out[1]);
}

console.log("\n--- a repeat with nothing to disambiguate with ---");
{
  const out = firstNames(["Dana", "Dana Kowalczyk"]);
  ok("the bare one stays bare rather than inventing an initial", out[0] === "Dana");
  ok("the one that can be told apart is", out[1] === "Dana K.");
}

console.log("\n--- what a collision does not do ---");
{
  // Three Danas and a Sam: the Sam must not be shortened because somebody
  // else collided. Only the colliding name pays.
  const out = firstNames(["Dana Ash", "Dana Boyd", "Dana Cole", "Sam Ash"]);
  ok("every Dana is distinguished", new Set(out.slice(0, 3)).size === 3);
  ok("and Sam is untouched", out[3] === "Sam");
}

console.log("\n--- the input is not trusted to be tidy ---");
{
  const out = firstNames(["  Riley   Van Der Berg ", "Riley Ng"]);
  ok("padding and double spaces do not become part of the name", out[0] === "Riley V.");
  ok("a two-word surname takes only its first letter", out[1] === "Riley N.");
  ok("nothing carries stray whitespace", out.every((n) => n === n.trim()));
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
