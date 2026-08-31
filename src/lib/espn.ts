/**
 * ESPN's public site API. These endpoints are undocumented and carry no
 * contract — they can change shape without notice, so everything here parses
 * defensively and a failure degrades to an empty result rather than throwing.
 *
 * Run `node scripts/verify-espn.mjs` against a live game week before trusting
 * the field names below.
 */

// Overridable so the parser can be exercised against a recorded response.
// Unset everywhere except a test harness, which is where it belongs.
const SITE =
  process.env.ESPN_API_BASE ?? "https://site.api.espn.com/apis/site/v2/sports/football/nfl";

export type SeasonType = 1 | 2 | 3; // preseason | regular | postseason

export interface Competitor {
  abbrev: string;
  name: string;
  score: number;
  homeAway: "home" | "away";
  winner: boolean;
  logo: string;
}

export interface Game {
  id: string;
  date: string;
  week: number;
  /** 1 preseason, 2 regular, 3 postseason — as ESPN labelled the event. */
  seasonType: SeasonType;
  /** pre | in | post — ESPN's own state, not derived from the clock. */
  state: "pre" | "in" | "post";
  completed: boolean;
  statusDetail: string;
  home: Competitor | null;
  away: Competitor | null;
}

export interface PlayerStat {
  name: string;
  team: string;
  /** ESPN's stat group: passing, rushing, receiving, kicking, defensive… */
  group: string;
  /** Column label to value, read off the group's own `labels` array. */
  stats: Record<string, string>;
}

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    // Live scores must not be served from a stale cache.
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`ESPN ${res.status} for ${url}`);
  return res.json();
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function competitorOf(raw: unknown): Competitor | null {
  const c = asRecord(raw);
  const team = asRecord(c.team);
  const abbrev = typeof team.abbreviation === "string" ? team.abbreviation : "";
  if (!abbrev) return null;

  return {
    abbrev,
    name: typeof team.displayName === "string" ? team.displayName : abbrev,
    score: Number(c.score ?? 0),
    homeAway: c.homeAway === "home" ? "home" : "away",
    winner: c.winner === true,
    logo: typeof team.logo === "string" ? team.logo : "",
  };
}

/**
 * Every game for a week, with live state and score. Omit `week` for the
 * scoreboard ESPN considers current.
 *
 * `seasonType` null asks ESPN for whatever is on right now rather than naming
 * a part of the season — in August that is the preseason, in January the
 * playoffs. Fantasy scoring must never do that (a preseason box score would
 * award points for a snap nobody's starters took), so it stays pinned to the
 * regular season by default and only the read-only scoreboard passes null.
 */
export async function fetchScoreboard(
  week?: number,
  seasonType: SeasonType | null = 2,
  year?: number,
): Promise<Game[]> {
  const params = new URLSearchParams();
  if (week != null) params.set("week", String(week));
  if (seasonType != null) params.set("seasontype", String(seasonType));
  if (year != null) params.set("dates", String(year));

  const body = asRecord(await getJson(`${SITE}/scoreboard?${params}`));

  return asArray(body.events).flatMap((raw): Game[] => {
    const event = asRecord(raw);
    const comp = asRecord(asArray(event.competitions)[0]);
    const status = asRecord(comp.status ?? event.status);
    const type = asRecord(status.type);
    const competitors = asArray(comp.competitors).map(competitorOf);

    const state = type.state === "in" || type.state === "post" ? type.state : "pre";

    // The event says which part of the season it belongs to. Trusting that
    // rather than the request matters when nothing was requested: asking ESPN
    // for "now" has to come back saying what "now" turned out to be.
    const labelled = Number(asRecord(event.season).type);
    const eventSeasonType: SeasonType =
      labelled === 1 || labelled === 2 || labelled === 3
        ? (labelled as SeasonType)
        : (seasonType ?? 2);

    return [
      {
        id: String(event.id ?? ""),
        date: typeof event.date === "string" ? event.date : "",
        week: Number(asRecord(event.week).number ?? week ?? 0),
        seasonType: eventSeasonType,
        state,
        completed: type.completed === true,
        statusDetail: typeof type.shortDetail === "string" ? type.shortDetail : "",
        home: competitors.find((c) => c?.homeAway === "home") ?? null,
        away: competitors.find((c) => c?.homeAway === "away") ?? null,
      },
    ];
  });
}

/**
 * Per-player statistics for one game. ESPN returns each stat group as a
 * `labels` array plus a parallel `stats` array per athlete, so the two are
 * zipped by name here rather than read by fixed position.
 */
export async function fetchGameStats(eventId: string): Promise<PlayerStat[]> {
  const body = asRecord(await getJson(`${SITE}/summary?event=${encodeURIComponent(eventId)}`));
  const out: PlayerStat[] = [];

  for (const rawTeam of asArray(asRecord(body.boxscore).players)) {
    const teamBlock = asRecord(rawTeam);
    const team = asRecord(teamBlock.team);
    const abbrev = typeof team.abbreviation === "string" ? team.abbreviation : "";

    for (const rawGroup of asArray(teamBlock.statistics)) {
      const group = asRecord(rawGroup);
      const labels = asArray(group.labels).map(String);
      const groupName = typeof group.name === "string" ? group.name : "";

      for (const rawAthlete of asArray(group.athletes)) {
        const entry = asRecord(rawAthlete);
        const athlete = asRecord(entry.athlete);
        const name = typeof athlete.displayName === "string" ? athlete.displayName : "";
        if (!name) continue;

        const values = asArray(entry.stats).map(String);
        const stats: Record<string, string> = {};
        labels.forEach((label, i) => {
          if (values[i] != null) stats[label] = values[i];
        });

        out.push({ name, team: abbrev, group: groupName, stats });
      }
    }
  }

  return out;
}
