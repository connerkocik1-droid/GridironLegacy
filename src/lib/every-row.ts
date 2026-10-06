/**
 * Every row a query matches, not the first thousand of them.
 *
 * PostgREST hands back at most a thousand rows a request, and it does so
 * silently: no error, no flag, just a shorter answer. player_scores holds the
 * whole pool every week — nine hundred-odd rows a Sunday — so a season read in
 * one request stopped being a season in week two. Whoever came back first kept
 * their points and everybody else read nought, which is how the rankings board
 * came to have backups above the men starting ahead of them.
 *
 * `page` must order the rows on something unique, or a row can slip between
 * two pages and another be read twice.
 */
export const PAGE_SIZE = 1000;

export async function everyRow<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const got = data ?? [];
    rows.push(...got);
    if (got.length < PAGE_SIZE) return rows;
  }
}
