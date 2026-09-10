import { find } from "@/data/league-data";

/**
 * What the league page says, worked out rather than written down.
 *
 * The handoff for this screen is unusual: almost none of its prose is
 * authored. The headlines, the trade grades, the three rotating cards and the
 * matchup reads are all generated from two tables — who played whom for how
 * many points, and what each player has scored against where he was drafted.
 * Push a real week of results in and the page rewrites itself.
 *
 * That is the whole reason this is a library with tests rather than a pile of
 * template strings in a component. A sentence that says "3 teams are riding 4
 * straight" when two of them are on three is worse than no sentence: it is the
 * league office being wrong in public. So every branch — ties, single leaders,
 * winless teams, tight games against blowouts — is a case here, and each one
 * has a test.
 *
 * Nothing in here knows about React or about fetching. It takes rows and
 * returns facts and sentences.
 */

export type Result = "W" | "L" | "T";

export interface Franchise {
  id: string;
  franchise: string;
  /** The manager's own name, which is what a headline calls them. */
  owner: string;
  division?: string | null;
  mine?: boolean;
}

export interface Fixture {
  week: number;
  home: string;
  away: string;
  homePoints: number;
  awayPoints: number;
  /** Only graded weeks count towards a record. */
  final: boolean;
}

export interface Standing extends Franchise {
  /** Oldest first, one per graded week. */
  results: Result[];
  /** What each graded week was worth, oldest first. */
  weekly: number[];
  wins: number;
  losses: number;
  ties: number;
  /** How many of the most recent results are the same, and which. */
  streak: number;
  streakKind: Result | "";
  pointsFor: number;
  pointsAgainst: number;
}

/** "1st", "2nd", "3rd", "11th" — the exceptions are the teens. */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  const ones = n % 10;
  return `${n}${ones === 1 ? "st" : ones === 2 ? "nd" : ones === 3 ? "rd" : "th"}`;
}

/** "4-1", or "4-1-1" when somebody has tied. */
export function recordOf(s: { wins: number; losses: number; ties: number }): string {
  return `${s.wins}-${s.losses}${s.ties ? `-${s.ties}` : ""}`;
}

/**
 * Records, streaks and points for, read off the schedule.
 *
 * Only graded weeks. A fixture that has not been settled is a fixture nobody
 * has won, and counting it would give every manager a loss on Thursday
 * morning.
 */
export function standings(franchises: Franchise[], fixtures: Fixture[]): Standing[] {
  const played = fixtures
    .filter((f) => f.final)
    .slice()
    .sort((a, b) => a.week - b.week);

  return franchises.map((team) => {
    const results: Result[] = [];
    const weekly: number[] = [];
    let pointsFor = 0;
    let pointsAgainst = 0;

    for (const f of played) {
      const home = f.home === team.id;
      if (!home && f.away !== team.id) continue;

      const mine = home ? f.homePoints : f.awayPoints;
      const theirs = home ? f.awayPoints : f.homePoints;
      results.push(mine > theirs ? "W" : mine < theirs ? "L" : "T");
      weekly.push(mine);
      pointsFor += mine;
      pointsAgainst += theirs;
    }

    const last = results[results.length - 1] ?? "";
    let streak = 0;
    for (let i = results.length - 1; i >= 0 && results[i] === last; i--) streak++;

    return {
      ...team,
      results,
      weekly,
      wins: results.filter((r) => r === "W").length,
      losses: results.filter((r) => r === "L").length,
      ties: results.filter((r) => r === "T").length,
      streak: last ? streak : 0,
      streakKind: last,
      pointsFor: Math.round(pointsFor * 10) / 10,
      pointsAgainst: Math.round(pointsAgainst * 10) / 10,
    };
  });
}

/** Record first, then points for — the order every league table uses. */
export function byRecord(rows: Standing[]): Standing[] {
  return rows
    .slice()
    .sort((a, b) => b.wins - a.wins || b.pointsFor - a.pointsFor);
}

/**
 * Everybody tied at the longest *active* win streak.
 *
 * Deliberately a list rather than a winner. Three weeks into a season half the
 * league is unbeaten, and a card that picks one of them and calls him the hot
 * hand is inventing a story the table does not support.
 */
export function hotStreaks(rows: Standing[]): { best: number; teams: Standing[] } {
  const best = rows.reduce((n, t) => Math.max(n, t.streakKind === "W" ? t.streak : 0), 0);
  if (!best) return { best: 0, teams: [] };
  return { best, teams: rows.filter((t) => t.streakKind === "W" && t.streak === best) };
}

export interface PlayerSeason {
  name: string;
  pos: string;
  team: string;
  points: number;
  games: number;
  /** Where he came off the board at his position, from the draft pool. */
  preRank: number | null;
  /** The franchise holding him, or null for a free agent. */
  franchise: string | null;
}

/**
 * The season so far, per player, joined to where he was drafted.
 *
 * `totals` is what the league has actually scored him — the rankings route's
 * shape. A player the pool has never heard of still belongs in the list; he
 * simply has no draft rank to have beaten, which is a different thing from
 * having beaten it by nothing.
 */
export function seasonPlayers(
  totals: Record<string, { total: number; games: number }>,
  rostered: Record<string, string> = {},
): PlayerSeason[] {
  const out: PlayerSeason[] = [];

  for (const [name, row] of Object.entries(totals)) {
    const pooled = find(name);
    // "WR31" → 31. A pool entry without one is a player who was never ranked.
    const rank = Number(String(pooled?.posRank ?? "").replace(/\D+/g, ""));

    out.push({
      name,
      pos: pooled?.p ?? "",
      team: pooled?.t ?? "",
      points: Math.round(Number(row.total) * 10) / 10,
      games: Number(row.games) || 0,
      preRank: Number.isFinite(rank) && rank > 0 ? rank : null,
      franchise: rostered[name] ?? null,
    });
  }

  return out.sort((a, b) => b.points - a.points);
}

/** Where he stands at his position now, by points scored. */
export function currentRank(players: PlayerSeason[], name: string): number {
  const p = players.find((x) => x.name === name);
  if (!p) return 0;
  return (
    players
      .filter((q) => q.pos === p.pos)
      .sort((a, b) => b.points - a.points)
      .findIndex((q) => q.name === name) + 1
  );
}

export interface Value {
  player: PlayerSeason;
  now: number;
  gain: number;
  read: string;
}

/**
 * The largest gain against where he was drafted, among players somebody owns.
 *
 * Three conditions, and each rules out a different way of being wrong.
 *
 * Ranked at all: a man with no draft slot cannot have climbed from one.
 *
 * Owned: this card is about somebody's drafting having come off, so a free
 * agent cannot win it. Once the whole pool started being scored — which it
 * had to, so that free agents have points at all — the best "value" in the
 * league was liable to be a man nobody thought worth a roster spot, which is
 * a fact about the waiver wire rather than about the draft.
 *
 * Scoring: a player on nought has not risen, he has simply not played.
 */
export function bestValue(players: PlayerSeason[], weeks: number): Value | null {
  const ranked = players.filter(
    (p) => p.preRank != null && p.pos && p.franchise != null && p.points > 0,
  );
  if (!ranked.length) return null;

  let best: Value | null = null;
  for (const player of ranked) {
    const now = currentRank(players, player.name);
    if (!now) continue;
    const gain = (player.preRank as number) - now;
    if (!best || gain > best.gain) best = { player, now, gain, read: "" };
  }
  if (!best) return null;

  const { player, now, gain } = best;
  const span = weeks === 1 ? "One week in" : `${weeks} weeks in`;

  // A player can be the best value in the league and still be behind where he
  // was drafted — somebody has to be the least bad. Saying he "climbed −4
  // spots" would be nonsense, so the sentence turns over.
  best.read =
    gain > 0
      ? `Drafted as the ${ordinal(player.preRank as number)} ${player.pos} off the board. ` +
        `${span} he is the ${ordinal(now)}, a ${gain}-spot climb and the largest in the league.`
      : gain === 0
        ? `Drafted as the ${ordinal(player.preRank as number)} ${player.pos} off the board, and ` +
          `${span.toLowerCase()} that is exactly where he sits. Nobody has beaten their draft slot yet.`
        : `Nobody in the league is ahead of where they were drafted. ${player.name} is the ` +
          `closest — the ${ordinal(player.preRank as number)} ${player.pos} off the board, now the ` +
          `${ordinal(now)}.`;

  return best;
}

/**
 * The highest scorers in the league, most first.
 *
 * Owned players only, for the same reason Best Value is. This card meant "the
 * league's top scorers" back when the league only scored what it held; once
 * the whole pool started being scored, "league-wide" quietly came to include
 * men nobody has ever started, and a free agent was liable to head the MVP
 * card on a fantasy league's own page. Restricting it restores what it always
 * meant rather than changing it.
 */
export function topScorers(players: PlayerSeason[], count = 3): PlayerSeason[] {
  return players
    .filter((p) => p.franchise != null && p.points > 0)
    .sort((a, b) => b.points - a.points)
    .slice(0, count);
}

export type Grade = "STEAL" | "SHARP" | "EVEN" | "RISKY";

export interface Move {
  kind: "TRADE" | "ADD" | "DROP" | "BLOCK";
  /** The manager the move is being judged for. */
  who: string;
  player: string;
  /** Whether the player moved toward this manager or away from them. */
  side: "in" | "out";
  cost?: string | null;
  when?: string;
}

/**
 * What a move turned out to be worth, and a sentence saying why.
 *
 * The record itself stays thin — who, what, which way. The judgement is
 * derived, so it changes as the player does: a trade that reads EVEN in
 * October reads STEAL in December without anybody rewriting it.
 */
export function gradeMove(
  move: Move,
  players: PlayerSeason[],
  weeks: number,
): { grade: Grade; read: string } | null {
  const p = players.find((x) => x.name === move.player);
  if (!p || p.preRank == null) return null;

  const now = currentRank(players, move.player);
  if (!now) return null;

  const gain = p.preRank - now;
  const gaining = move.side === "in" ? gain : -gain;
  const grade: Grade =
    gaining >= 10 ? "STEAL" : gaining >= 3 ? "SHARP" : gaining > -3 ? "EVEN" : "RISKY";

  const surname = p.name.split(" ").slice(-1)[0];
  const spent = `${surname} has put up ${p.points.toFixed(1)} through ${weeks} ${
    weeks === 1 ? "week" : "weeks"
  } — ${p.pos}${now} on the season, drafted ${p.pos}${p.preRank}.`;

  const verdict =
    gaining >= 3
      ? `That is ${Math.abs(gain)} spots of value moving ${
          move.side === "in" ? "toward" : "away from"
        } ${move.who}.`
      : gaining <= -3
        ? `Losing ${Math.abs(gain)} spots of value is the part ${move.who} will hear about.`
        : "Roughly where the draft had him, so nobody won this one.";

  return { grade, read: `${spent} ${verdict}` };
}

export interface NewsItem {
  tag: string;
  head: string;
  body: string;
  /** Amber for the bad news, accent for the rest. */
  tone: "league" | "cold";
}

/**
 * The week's news, written from the week's own numbers.
 *
 * Five kinds, each of which only appears when the table actually supports it:
 * a league with nothing graded has no highest week, and a league where
 * everybody has won has no winless item. An empty list is the correct answer
 * in September and the page says so rather than inventing five headlines.
 */
export function leagueNews(
  rows: Standing[],
  players: PlayerSeason[],
  weeks: number,
): NewsItem[] {
  const items: NewsItem[] = [];
  if (!weeks) return items;

  // The highest single week anybody has posted.
  let peak: { team: Standing; points: number } | null = null;
  for (const team of rows) {
    for (const points of team.weekly) {
      if (!peak || points > peak.points) peak = { team, points };
    }
  }
  if (peak) {
    items.push({
      tag: "SCORES",
      tone: "league",
      head: `${peak.team.owner} put up ${peak.points.toFixed(1)}`,
      body:
        `The highest single week anyone has posted this season. ${peak.team.franchise} sits ` +
        `${recordOf(peak.team)} with ${peak.team.pointsFor.toFixed(1)} for.`,
    });
  }

  const value = bestValue(players, weeks);
  if (value && value.gain > 0) {
    items.push({
      tag: "VALUE",
      tone: "league",
      head: `${value.player.name} is the league's biggest riser`,
      body:
        `Drafted ${value.player.pos}${value.player.preRank}, now ${value.player.pos}${value.now} ` +
        `on ${value.player.points.toFixed(1)} points. A ${value.gain}-spot climb in ${weeks} ` +
        `${weeks === 1 ? "week" : "weeks"}.`,
    });
  }

  const { best, teams: hot } = hotStreaks(rows);
  if (best > 1) {
    items.push({
      tag: "STREAK",
      tone: "league",
      head:
        hot.length > 1
          ? `${hot.map((t) => t.owner).join(" and ")} are all on ${best} straight`
          : `${hot[0].owner} has won ${best} in a row`,
      body:
        "Longest active run in the league. " +
        (hot.length > 1 ? "None of them has met the others yet." : "Nobody else is close."),
    });
  }

  const byPoints = rows.slice().sort((a, b) => b.pointsFor - a.pointsFor);
  if (byPoints.length > 1 && byPoints[0].pointsFor > 0) {
    const lead = byPoints[0];
    const gap = lead.pointsFor - byPoints[1].pointsFor;
    items.push({
      tag: "POINTS",
      tone: "league",
      head: `${lead.owner} leads the league in points for`,
      body:
        `${lead.pointsFor.toFixed(1)} through ${weeks} ${weeks === 1 ? "week" : "weeks"}, ` +
        `${gap.toFixed(1)} clear of second. Record sits at ${recordOf(lead)}.`,
    });
  }

  const winless = rows.filter((t) => t.wins === 0 && t.results.length > 0);
  if (winless.length) {
    items.push({
      tag: "COLD",
      tone: "cold",
      head: `${winless.map((t) => t.owner).join(" and ")} still looking for a first win`,
      body:
        winless.map((t) => `${t.franchise} has scored ${t.pointsFor.toFixed(1)}`).join("; ") +
        ". The wire is open nightly.",
    });
  }

  return items;
}

/**
 * What the gap between two projections actually means.
 *
 * Three readings rather than one, because "projected to win by 0.4" and
 * "projected to win by 30" are not the same sentence with a different number
 * in it.
 */
export function matchupRead(favourite: string, underdog: string, gap: number): string {
  const margin = Math.abs(gap);
  if (margin < 4) {
    return `Nothing in it — ${margin.toFixed(1)} between them on projection. This one turns on whoever has the late game.`;
  }
  if (margin < 18) {
    return `${favourite} project ${margin.toFixed(1)} clear of ${underdog}. Close enough that one big afternoon flips it.`;
  }
  return `${favourite} project ${margin.toFixed(1)} clear of ${underdog}. It would take something going badly wrong.`;
}
