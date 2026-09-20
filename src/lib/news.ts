import { POOL } from "@/data/league-data";
import { normalizeName } from "./player-names";
import { buildIndex, isFresh, playersIn } from "./player-search";

/**
 * Forty was the old limit, and forty league-wide NFL articles is how a manager
 * ends up with no news about any of his own men. The endpoint is the one the
 * app has always used — only the number changed — and ESPN caps it wherever it
 * caps it; asking for more can return fewer but never fewer than before.
 */
const NEWS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=100";

/**
 * The pool, indexed once per server process rather than once per request.
 * Nine hundred names against a hundred headlines is cheap; rebuilding the
 * index for each of them is not.
 *
 * Built on first use rather than at import. NewsWire is a client component and
 * imports timeAgo from this module, so anything done at the top level here is
 * done in every visitor's browser — and the index is only ever read on the
 * server, where the wire is fetched.
 */
let index: ReturnType<typeof buildIndex> | null = null;
function pool() {
  if (!index) index = buildIndex(POOL as { n: string }[]);
  return index;
}

export interface Story {
  id: string;
  headline: string;
  description: string;
  published: string;
  byline: string;
  link: string | null;
  image: string | null;
  players: string[];
}

interface EspnAthlete {
  displayName?: string;
}

interface EspnStory {
  id?: number | string;
  headline?: string;
  description?: string;
  published?: string;
  byline?: string;
  links?: { web?: { href?: string } };
  images?: { url?: string }[];
  categories?: { type?: string; athlete?: EspnAthlete }[];
}

/**
 * The NFL news wire.
 *
 * Fetched on the server rather than from each visitor's browser: twelve
 * browsers hammering ESPN independently gets nothing cached and nothing
 * shared, and the response is the same for everyone.
 *
 * ESPN's endpoints are public and undocumented — there is no contract and they
 * can change without notice — so a failure returns an empty list and the page
 * says so, rather than breaking.
 */
export async function fetchNews(revalidateSeconds = 900): Promise<Story[]> {
  return (await readNews(revalidateSeconds)).stories;
}

/**
 * The same wire, saying whether it was actually reached.
 *
 * An empty list means two very different things — the wire is quiet, or the
 * wire is down — and callers that cache need to tell them apart. Caching a
 * failure is how one bad minute at ESPN becomes twenty minutes of a league
 * with no news, which is what "we have no news" looks like from the outside.
 */
export async function readNews(
  revalidateSeconds = 900,
): Promise<{ stories: Story[]; ok: boolean }> {
  try {
    const res = await fetch(NEWS_URL, { next: { revalidate: revalidateSeconds } });
    if (!res.ok) return { stories: [], ok: false };

    const body = (await res.json()) as { articles?: EspnStory[] };

    const names = pool();

    const stories = (body.articles ?? [])
      .map((a, i) => {
        const headline = a.headline ?? "Untitled";
        const description = a.description ?? "";

        // Who ESPN says it is about, and who it actually names. The union,
        // because the two disagree in both directions: ESPN tags a man the
        // text never mentions about as often as it leaves out one it does.
        //
        // ESPN's own tag is kept as ESPN spelled it only when the pool has no
        // spelling of its own — everything downstream matches these against
        // rosters by string equality, so "Marvin Harrison Jr" and
        // "Marvin Harrison Jr." have to arrive as one name.
        const tagged = (a.categories ?? [])
          .filter((c) => c.type === "athlete" && c.athlete?.displayName)
          .map((c) => c.athlete!.displayName!);

        const players = [...new Set([
          ...playersIn(`${headline} ${description}`, names),
          ...tagged.map((t) => names.full.get(normalizeName(t)) ?? t),
        ])];

        return {
          id: String(a.id ?? i),
          headline,
          description,
          published: a.published ?? "",
          byline: a.byline ?? "",
          link: a.links?.web?.href ?? null,
          image: a.images?.[0]?.url ?? null,
          players,
        };
      })
      // Two weeks, newest first. A wire is only a wire while it is current:
      // an item from October at the top of a feed in December reads as the
      // feature being broken, which is how it was being read.
      .filter((s) => isFresh(s.published))
      .sort((a, b) => Date.parse(b.published) - Date.parse(a.published));

    // Reached, and it had nothing: that is a quiet wire, not a broken one.
    return { stories, ok: true };
  } catch {
    return { stories: [], ok: false };
  }
}

/** How long ago, in the shortest form that is still clear. */
export function timeAgo(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";

  const minutes = Math.floor((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : new Date(then).toLocaleDateString();
}
