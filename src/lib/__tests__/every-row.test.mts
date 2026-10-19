import { everyRow, PAGE_SIZE } from "../every-row";

let failed = 0;
const ok = (label: string, got: boolean, want = true) => {
  const pass = got === want;
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}`);
  if (!pass) failed++;
};

/** A table that answers the way PostgREST does: never more than a page. */
const table = (size: number) => {
  const rows = Array.from({ length: size }, (_, i) => i);
  const asked: [number, number][] = [];
  const page = async (from: number, to: number) => {
    asked.push([from, to]);
    return { data: rows.slice(from, Math.min(to + 1, from + PAGE_SIZE)), error: null };
  };
  return { page, asked };
};

{
  // Five weeks of a nine-hundred-man pool: the case the board broke on.
  const { page } = table(4500);
  const got = await everyRow(page);
  ok("a season longer than one page comes back whole", got.length === 4500);
  ok("in order, with nothing read twice", got.every((v, i) => v === i));
}

{
  const { page, asked } = table(PAGE_SIZE);
  const got = await everyRow(page);
  ok("exactly one page still asks for the next to be sure", got.length === PAGE_SIZE && asked.length === 2);
}

{
  const { page, asked } = table(0);
  const got = await everyRow(page);
  ok("an empty table is one request and no rows", got.length === 0 && asked.length === 1);
}

{
  let threw = false;
  try {
    await everyRow(async () => ({ data: null, error: new Error("down") }));
  } catch {
    threw = true;
  }
  ok("a failed page is an error, not a short season", threw);
}

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
