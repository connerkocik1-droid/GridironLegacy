/**
 * Reading more than a thousand score rows.
 *
 * The bug this exists for is a silent one: PostgREST answers a too-big select
 * with the first thousand rows and a 200, so the caller cannot tell a complete
 * answer from a truncated one. Three routes read a whole league's scores that
 * way and all three quietly lost data as the season grew.
 *
 * So the fake below behaves the way the real thing does — it caps every
 * response at a thousand rows and honours range() — and the tests ask the
 * question the routes needed answered: did everything come back, exactly once.
 */

import { readScores } from "../scores.ts";

let failed = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : ` — got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
  if (!pass) failed++;
};

const CAP = 1000;

/** A league's worth of rows: `weeks` weeks of `perWeek` players. */
function rows(weeks: number, perWeek: number) {
  const out = [];
  for (let w = 1; w <= weeks; w++) {
    for (let p = 0; p < perWeek; p++) {
      out.push({ player_name: `P${String(p).padStart(4, "0")}`, points: 1, week: w });
    }
  }
  return out;
}

/**
 * Postgres with a row cap. Sorted by the order() calls, sliced by range(), and
 * never handing back more than the cap however much was asked for.
 */
function fakeDb(all: ReturnType<typeof rows>, { cap = CAP } = {}) {
  let calls = 0;
  const api = {
    calls: () => calls,
    from() { return api; },
    select() { return api; },
    eq(col: string, value: unknown) {
      if (col === "week") api._week = value as number;
      return api;
    },
    order() { return api; },
    range(from: number, to: number) {
      calls++;
      const scoped = api._week == null ? all : all.filter((r) => r.week === api._week);
      const sorted = [...scoped].sort(
        (a, b) => a.week - b.week || a.player_name.localeCompare(b.player_name));
      const page = sorted.slice(from, to + 1).slice(0, cap);
      return Promise.resolve({ data: page, error: null });
    },
    _week: null as number | null,
  };
  return api;
}

const read = (db: unknown, week?: number) =>
  // The helper only ever uses the query-builder surface the fake implements.
  readScores(db as never, "L", "player_name, points, week", week);

console.log("--- everything comes back ---");
{
  // Three thousand rows: three full pages and an empty fourth.
  const all = rows(10, 300);
  const db = fakeDb(all);
  const got = await read(db);
  eq("a league bigger than the cap is read whole", got.length, 3000);
  eq("and every row is distinct",
     new Set(got.map((r) => `${r.week}:${r.player_name}`)).size, 3000);
  eq("which took four pages", db.calls(), 4);
}

console.log("\n--- the last page ---");
{
  // Exactly one page, then a short second that ends it.
  const db = fakeDb(rows(1, 1000));
  const got = await read(db);
  eq("a league of exactly one page is read whole", got.length, 1000);
  eq("and it takes a second call to know that", db.calls(), 2);
}
{
  const db = fakeDb(rows(1, 40));
  const got = await read(db);
  eq("a small league takes one call", db.calls(), 1);
  eq("and comes back whole", got.length, 40);
}
{
  const db = fakeDb([]);
  eq("an empty league is empty, not an error", (await read(db)).length, 0);
}

console.log("\n--- one week of it ---");
{
  const db = fakeDb(rows(10, 300));
  const got = await read(db, 4);
  eq("asking for a week gets that week", got.length, 300);
  eq("and only that week", [...new Set(got.map((r) => r.week))], [4]);
}

console.log("\n--- what the unpaged read did ---");
{
  // The bug, stated as a test: one shot at a capped server loses everything
  // past the cap, and says nothing about it.
  const all = rows(10, 300);
  const db = fakeDb(all);
  const oneShot = await db.range(0, 99_999);
  eq("a single select comes back truncated", oneShot.data.length, CAP);
  eq("and silently: no error with it", oneShot.error, null);
  // Which weeks vanish is the part that made this look like a lag rather than
  // a fault — ordered reads lose the newest, and the newest is this week.
  eq("the weeks it loses are the recent ones",
     Math.max(...oneShot.data.map((r) => r.week)), 4);
  eq("while the paged read keeps all ten",
     Math.max(...(await read(fakeDb(all))).map((r) => r.week)), 10);
}

console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
