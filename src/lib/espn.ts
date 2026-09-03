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
  /**
   * "QB", "TE" — when ESPN says. It often does not, and nothing that scores
   * points depends on it: a tight end and a receiver are scored identically.
   * It matters only for working out which slot a player could fill.
   */
  position?: string;
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
  /**
   * Whole-team totals, by abbreviation: "totalYards", "turnovers" and the
   * rest of the row along the bottom of a box score.
   *
   * A defence is judged partly on what the other side gained, and that number
   * exists nowhere in the per-player lines — a hundred and forty rushing yards
   * spread over four backs has to be added up by somebody, and ESPN has
   * already done it.
   */
  teamTotals: Record<string, Record<string, string>>;
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
  // Positions come from the roster block rather than from the box score,
  // which carries them only sometimes. Read first, so the box score can be
  // filled in from it as it is parsed.
  const positions = readRosterPositions(body);

  return {
    stats: readBoxScore(body, positions),
    plays: readScoringPlays(body),
    teamTotals: readTeamTotals(body),
  };
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
function readBoxScore(
  body: Record<string, unknown>,
  positions: Map<string, string> = new Map(),
): PlayerStat[] {
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

        // The box score's own position when it has one, the team sheet's
        // when it does not. Between them a player should never have to be
        // guessed at from the columns he appears in.
        const stated = asRecord(athlete.position).abbreviation;
        const id = typeof athlete.id === "string" || typeof athlete.id === "number"
          ? String(athlete.id)
          : "";
        const position =
          (typeof stated === "string" && stated ? stated : "") ||
          (id ? positions.get(`#${id}`) : undefined) ||
          positions.get(name.toLowerCase()) ||
          undefined;

        out.push({ name, team: abbrev, group: groupName, stats, position });
      }
    }
  }

  return out;
}

/**
 * Every player named on either team sheet, and what he plays.
 *
 * The box score is a set of stat tables and only sometimes says what position
 * a man plays; the roster block is the team sheet and always does. Keyed twice
 * — by athlete id and by lower-cased name — because the id is exact when it is
 * there and the name is all there is when it is not.
 */
function readRosterPositions(body: Record<string, unknown>): Map<string, string> {
  const out = new Map<string, string>();

  const note = (key: string, position: string) => {
    if (!key || !position) return;
    if (!out.has(key)) out.set(key, position);
  };

  for (const rawTeam of asArray(body.rosters)) {
    for (const rawEntry of asArray(asRecord(rawTeam).roster)) {
      const entry = asRecord(rawEntry);
      const athlete = asRecord(entry.athlete);

      // The position hangs off the entry on some responses and off the
      // athlete on others.
      const position =
        asRecord(entry.position).abbreviation ?? asRecord(athlete.position).abbreviation;
      if (typeof position !== "string" || !position) continue;

      const id = athlete.id ?? entry.playerId;
      if (typeof id === "string" || typeof id === "number") note(`#${id}`, position);

      const name = athlete.displayName ?? athlete.fullName;
      if (typeof name === "string") note(name.toLowerCase(), position);
    }
  }

  return out;
}

/**
 * The team-total row, keyed by ESPN's own stat names ("totalYards",
 * "netPassingYards", "rushingYards"…).
 */
function readTeamTotals(body: Record<string, unknown>): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};

  for (const raw of asArray(asRecord(body.boxscore).teams)) {
    const block = asRecord(raw);
    const abbrev = asRecord(block.team).abbreviation;
    if (typeof abbrev !== "string" || !abbrev) continue;

    const totals: Record<string, string> = {};
    for (const rawStat of asArray(block.statistics)) {
      const stat = asRecord(rawStat);
      const name = typeof stat.name === "string" ? stat.name : "";
      const value = stat.displayValue;
      if (name && (typeof value === "string" || typeof value === "number")) {
        totals[name] = String(value);
      }
    }

    out[abbrev] = totals;
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

/**
 * The league's injury report.
 *
 * A separate endpoint from everything else here, and the only one whose answer
 * is about a player rather than about a game. ESPN groups it by team, each with
 * a list of the men who are on it; anybody not on it is fit, which is why the
 * absence of a name is as meaningful as the presence of one.
 */
export interface InjuryReport {
  /** ESPN's own status word: "Questionable", "Injured Reserve", "Out"… */
  status: string;
  /** The line ESPN prints under it, when it prints one. */
  detail: string;
  name: string;
  team: string;
}

export async function fetchInjuries(): Promise<InjuryReport[]> {
  const body = asRecord(await getJson(`${SITE}/injuries`));
  const out: InjuryReport[] = [];

  for (const rawTeam of asArray(body.injuries)) {
    const block = asRecord(rawTeam);
    const teamName = typeof block.displayName === "string" ? block.displayName : "";

    for (const rawEntry of asArray(block.injuries)) {
      const entry = asRecord(rawEntry);
      const athlete = asRecord(entry.athlete);

      const name = typeof athlete.displayName === "string" ? athlete.displayName : "";
      if (!name) continue;

      // The status hangs off the entry as a string on some responses and as a
      // { name } object on others.
      const type = asRecord(entry.type);
      const status =
        (typeof entry.status === "string" ? entry.status : "") ||
        (typeof type.description === "string" ? type.description : "") ||
        (typeof type.name === "string" ? type.name : "");

      const shortComment = asRecord(entry.details).type;

      out.push({
        name,
        team: teamName,
        status,
        detail:
          (typeof entry.shortComment === "string" ? entry.shortComment : "") ||
          (typeof shortComment === "string" ? shortComment : ""),
      });
    }
  }

  return out;
}

/* ------------------------------------------------------------------ rosters -
 *
 * Where a position comes from when the game itself will not say.
 *
 * A game summary states a position in two places and neither is reliable: the
 * box score's athlete objects are often trimmed to an id and a name, and the
 * `rosters` block is absent from plenty of preseason responses. What is left
 * is the team sheet — /teams/{abbrev}/roster — which is the one NFL endpoint
 * that always carries `position.abbreviation`, for every player on the club
 * rather than only the ones who recorded a statistic.
 *
 * Fetching it is the difference between knowing a man is a tight end and
 * guessing from the fact that he caught a pass. The guess cannot tell a tight
 * end from a receiver or a fullback from a back, which is exactly the
 * distinction a lineup slot turns on, so guessing is worse than not knowing.
 */

/** A team sheet, keyed by athlete id and by lower-cased name. */
export type PositionIndex = Map<string, string>;

interface CachedRoster {
  positions: PositionIndex;
  at: number;
}

/**
 * Team sheets barely move inside a week and this is read on the path that
 * refreshes live scores every twenty seconds. Six hours means one fetch per
 * club per session rather than one per refresh, and a signing that lands
 * mid-afternoon is picked up by the evening.
 */
const ROSTER_TTL_MS = 6 * 60 * 60 * 1000;

const rosterCache = new Map<string, CachedRoster>();

/** Empties the cache. Exported for tests, which must not inherit each other's. */
export function forgetTeamRosters(): void {
  rosterCache.clear();
}

/**
 * Every player on one club, and what he plays.
 *
 * ESPN groups the squad into offense, defence and special teams on this
 * endpoint, and returns a flat list on some responses, so both shapes are
 * read. A club that cannot be fetched yields an empty sheet rather than
 * throwing: a missing position costs a slot label, and nothing here is worth
 * failing a whole week's scoring over.
 */
export async function fetchTeamRoster(team: string): Promise<PositionIndex> {
  const abbrev = team.trim().toUpperCase();
  const out: PositionIndex = new Map();
  if (!abbrev) return out;

  const cached = rosterCache.get(abbrev);
  if (cached && Date.now() - cached.at < ROSTER_TTL_MS) return cached.positions;

  let body: Record<string, unknown>;
  try {
    body = asRecord(await getJson(`${SITE}/teams/${abbrev.toLowerCase()}/roster`));
  } catch (err) {
    console.error(`[espn] team sheet for ${abbrev} failed`, err);
    return out;
  }

  const note = (key: unknown, position: unknown) => {
    if (typeof position !== "string" || !position) return;
    if (typeof key === "string") {
      if (key && !out.has(key.toLowerCase())) out.set(key.toLowerCase(), position);
    } else if (typeof key === "number") {
      out.set(`#${key}`, position);
    }
  };

  const readAthlete = (raw: unknown) => {
    const athlete = asRecord(raw);
    const position = asRecord(athlete.position).abbreviation;
    if (typeof position !== "string" || !position) return;

    const id = athlete.id;
    if (typeof id === "string" || typeof id === "number") {
      if (!out.has(`#${id}`)) out.set(`#${id}`, position);
    }
    note(athlete.displayName, position);
    note(athlete.fullName, position);
  };

  for (const rawGroup of asArray(body.athletes)) {
    const group = asRecord(rawGroup);
    const items = asArray(group.items);
    // Grouped by unit on most responses, flat on some. A flat entry is an
    // athlete in its own right and has no `items` to walk.
    if (items.length) items.forEach(readAthlete);
    else readAthlete(rawGroup);
  }

  rosterCache.set(abbrev, { positions: out, at: Date.now() });
  return out;
}

/**
 * Fills in the positions a game did not state, from the team sheets.
 *
 * What comes back holds one guarantee the input does not: if a position is
 * known for a player from any source at all — one of his own rows, or his
 * club's sheet — then every row of his carries it. A caller reading a single
 * row therefore never has to go looking through the others.
 *
 * Only the clubs with a man nobody has named are fetched, and a game whose box
 * score labelled everybody costs no requests. The stats come back as a new
 * array; the input is left alone.
 */
export async function withTeamPositions(stats: PlayerStat[]): Promise<PlayerStat[]> {
  // A player appears once per stat group he features in, so a missing position
  // is a property of the man rather than of the row: a back carrying "RB" on
  // his rushing line and nothing on his fumbles line does not need looking up.
  // Deciding this per row instead would fetch a club's sheet for a player it
  // already had, which on a thirteen-game Sunday is a request per club per
  // refresh for no answer that was not already in hand.
  const key = (s: PlayerStat) => `${s.team}|${s.name.toLowerCase()}`;

  const known = new Map<string, string>();
  for (const stat of stats) {
    if (stat.position && !known.has(key(stat))) known.set(key(stat), stat.position);
  }

  // Only the clubs with a man nobody has named are asked, and a game that
  // labelled everybody asks nobody at all — which is most regular-season
  // games, and the case this must not make expensive.
  const gaps = stats.filter((s) => !known.has(key(s)));
  const sheets = new Map<string, PositionIndex>();

  if (gaps.length) {
    const teams = [...new Set(gaps.map((s) => s.team).filter(Boolean))];
    await Promise.all(
      teams.map(async (team) => {
        sheets.set(team, await fetchTeamRoster(team));
      }),
    );
  }

  return stats.map((stat) => {
    if (stat.position) return stat;
    const found =
      known.get(key(stat)) ?? sheets.get(stat.team)?.get(stat.name.toLowerCase());
    return found ? { ...stat, position: found } : stat;
  });
}
