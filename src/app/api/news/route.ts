import { fetchNews } from "@/lib/news";

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
  const stories = await fetchNews();
  return Response.json(
    { stories },
    {
      // Shared rather than private: there is nothing per-manager in this
      // response, and the filtering happens in the browser against a roster
      // fetched separately.
      headers: { "cache-control": "public, max-age=300, stale-while-revalidate=900" },
    },
  );
}
