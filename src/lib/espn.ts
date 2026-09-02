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

/**
 * One play that put points on the board.
 *
 * The box score cannot see several things fantasy scoring needs. It gives
 * field goals as "3/4" with a single LONG, so two fifty-yarders look like one.
 * It has no column at all for a two-point conversion or a safety. Those live
 * only in the scoring summary, as prose.
 *
 * So `text` is parsed — carefully, and never as the only source. Everything
 * read out of it is a correction applied on top of a score the box score can
 * already stand up on its own, so a change in ESPN's wording costs accuracy
 * rather than correctness.
 */
export interface ScoringPlay {
  /** ESPN's own abbreviation: TD, FG, SF, EP… */
  type: string;
  /** The abbreviation of the team that scored. */
  team: string;
  /** "Harrison Butker 54 Yd Field Goal" — free text, and treated as such. */
  text: string;
  /**
   * What this play was worth to the team that scored it, measured by how far
   * their running score moved rather than by what the play was called.
   *
   * This is the whole trick for extra points. ESPN folds the conversion into
   * the touchdown's own text, so a touchdown is worth six, seven or eight and
   * only the scoreboard says which. Eight means a two-point conversion was
   * good; prose never has to be trusted for that.
   */
  value: number;
}

/** A game's box score and its scoring summary, from one request. */
export interface GameDetail {
  stats: PlayerStat[];
  plays: ScoringPlay[];
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
 * A game's box score and scoring summary, from the one request that carries
 * both. Everything fantasy scoring needs about a game comes from here.
 */
export async function fetchGameDetail(eventId: string): Promise<GameDetail> {
  const body = asRecord(await getJson(`${SITE}/summary?event=${encodeURIComponent(eventId)}`));
  return { stats: readBoxScore(body), plays: readScoringPlays(body) };
}

/**
 * Per-player statistics for one game.
 *
 * Kept as its own entry point because the verification script and the tests
 * ask for exactly this and nothing else.
 */
export async function fetchGameStats(eventId: string): Promise<PlayerStat[]> {
  return (await fetchGameDetail(eventId)).stats;
}

/**
 * ESPN returns each stat group as a `labels` array plus a parallel `stats`
 * array per athlete, so the two are zipped by name here rather than read by
 * fixed position.
 */
function readBoxScore(body: Record<string, unknown>): PlayerStat[] {
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

/**
 * The scoring summary: every play that changed the score, in ESPN's own words.
 *
 * `value` is read from ESPN rather than inferred from the type, because a
 * touchdown play's value already folds in whatever followed it — seven with
 * the extra point, eight with a two-point conversion, six when the kick was
 * missed. That arithmetic is what makes the conversion recoverable at all.
 */
function readScoringPlays(body: Record<string, unknown>): ScoringPlay[] {
  const out: ScoringPlay[] = [];

  // The scoreboard after the previous scoring play, which is what makes the
  // next one's value a subtraction.
  let home = 0;
  let away = 0;

  const competitors = asArray(asRecord(asArray(asRecord(body.header).competitions)[0]).competitors);
  const homeAbbrev = abbrevOfSide(competitors, "home");

  for (const raw of asArray(body.scoringPlays)) {
    const play = asRecord(raw);
    const type = asRecord(play.type);
    const team = asRecord(play.team);

    const text = typeof play.text === "string" ? play.text : "";

    const nextHome = Number(play.homeScore ?? home);
    const nextAway = Number(play.awayScore ?? away);
    const abbrev = typeof team.abbreviation === "string" ? team.abbreviation : "";

    // Whichever side's total moved is the side that scored, so the value holds
    // even when the play carries no usable team.
    const homeDelta = nextHome - home;
    const awayDelta = nextAway - away;
    const scored = abbrev && homeAbbrev ? (abbrev === homeAbbrev ? homeDelta : awayDelta)
      : Math.max(homeDelta, awayDelta);

    home = Number.isFinite(nextHome) ? nextHome : home;
    away = Number.isFinite(nextAway) ? nextAway : away;

    if (!text) continue;

    out.push({
      type: typeof type.abbreviation === "string" ? type.abbreviation : "",
      // The summary identifies the scoring team by id on some responses and by
      // abbreviation on others; only the abbreviation is any use downstream.
      team: abbrev,
      text,
      // Falls back to what ESPN called the play when the running score is
      // missing or went backwards, which would otherwise read as a value of 0.
      value: Number.isFinite(scored) && scored > 0 ? scored : Number(play.scoreValue ?? 0),
    });
  }

  return out;
}

/** The abbreviation of the home or away competitor in a summary header. */
function abbrevOfSide(competitors: unknown[], side: "home" | "away"): string {
  for (const raw of competitors) {
    const c = asRecord(raw);
    if (c.homeAway !== side) continue;
    const team = asRecord(c.team);
    if (typeof team.abbreviation === "string") return team.abbreviation;
  }
  return "";
}
