const NEWS_URL = "https://site.api.espn.com/apis/site/v2/sports/football/nfl/news?limit=40";

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
  try {
    const res = await fetch(NEWS_URL, { next: { revalidate: revalidateSeconds } });
    if (!res.ok) return [];

    const body = (await res.json()) as { articles?: EspnStory[] };

    return (body.articles ?? []).map((a, i) => ({
      id: String(a.id ?? i),
      headline: a.headline ?? "Untitled",
      description: a.description ?? "",
      published: a.published ?? "",
      byline: a.byline ?? "",
      link: a.links?.web?.href ?? null,
      image: a.images?.[0]?.url ?? null,
      // The athletes ESPN tagged, so a story can be matched to a roster.
      players: (a.categories ?? [])
        .filter((c) => c.type === "athlete" && c.athlete?.displayName)
        .map((c) => c.athlete!.displayName!),
    }));
  } catch {
    return [];
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
