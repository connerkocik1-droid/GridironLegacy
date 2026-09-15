import { readNews } from "@/lib/news";

/**
 * The wire, for the band on the home page.
 *
 * The /news page renders its stories on the server. The home page cannot: it
 * is a client component that also has to know this manager's roster and
 * watchlist, and the wire is the same for everybody while those are not.
 *
 * So the wire comes through here — and fetchNews carries Next's own revalidate
 * window, so twelve managers refreshing the home page still make one request
 * to ESPN between windows rather than twelve.
 */
export async function GET() {
  const { stories, ok } = await readNews();
  return Response.json(
    { stories, ok },
    {
      // Shared rather than private: there is nothing per-manager in this
      // response, and the filtering happens in the browser against a roster
      // fetched separately.
      //
      // A failure is never cached. Five minutes of shared cache plus fifteen
      // of stale-while-revalidate turns one unreachable minute at ESPN into
      // twenty minutes of an empty wire for the whole league, and an empty
      // wire is indistinguishable from a broken feature.
      headers: {
        "cache-control": ok
          ? "public, max-age=300, stale-while-revalidate=900"
          : "no-store",
      },
    },
  );
}
