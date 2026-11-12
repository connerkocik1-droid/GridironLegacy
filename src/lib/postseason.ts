import { bracketShape, roundName } from "./playoff-picture";
import type { serverClient } from "./supabase";

const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 >= 11 && n % 100 <= 13 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;

type Db = Awaited<ReturnType<typeof serverClient>>;

export type PostseasonKind = "waiting" | "bye" | "out" | "missed" | "champion" | "alive";

export interface Postseason {
  kind: PostseasonKind;
  /** One sentence for the screen where the matchup would be. */
  message: string;
}

interface Game {
  week: number;
  playoff: boolean;
  playoff_round: number | null;
  bracket: string | null;
  home_manager: string;
  away_manager: string;
  winner: string | null;
  final: boolean;
}

/**
 * Where a franchise stands in a week after the regular season: why there is
 * no matchup to show, or what is coming.
 *
 * Null for a regular-season week — a franchise without a fixture then has an
 * ordinary bye, which the screens already say. After it, "no fixture" means
 * one of four different things and each deserves its own sentence: the
 * bracket isn't drawn yet, a top seed is resting, a team has been knocked
 * out, or it never made the field.
 */
export async function postseasonFor(db: Db, leagueId: string, managerId: string, week: number): Promise<Postseason | null> {
  const [{ data: games }, { data: league }, { data: managers }] = await Promise.all([
    db
      .from("matchups")
      .select("week, playoff, playoff_round, bracket, home_manager, away_manager, winner, final")
      .eq("league_id", leagueId),
    db.from("leagues").select("season").eq("id", leagueId).single(),
    db.from("managers").select("id, franchise").eq("league_id", leagueId),
  ]);

  const all = (games ?? []) as Game[];
  const regular = all.filter((g) => !g.playoff);
  if (!regular.length) return null;
  const lastRegular = Math.max(...regular.map((g) => g.week));
  if (week <= lastRegular) return null;

  const season = league?.season;
  const [{ data: seeds }, { data: champions }, { data: finish }] = await Promise.all([
    db.from("playoff_seeds").select("seed, manager_id").eq("league_id", leagueId).eq("season", season ?? 0),
    db.from("league_champions").select("manager_id, franchise").eq("league_id", leagueId).eq("season", season ?? 0),
    db.from("season_finish").select("place, manager_id").eq("league_id", leagueId).eq("season", season ?? 0),
  ]);
  const placed = (finish ?? []).find((f) => f.manager_id === managerId)?.place;
  const total = (managers ?? []).length;
  const finished = (place: number) =>
    `You finished ${ordinal(place)} of ${total}${place === total ? " — and you pick first in the rookie draft" : ""}.`;
  const name = (id: string | null | undefined) => (managers ?? []).find((m) => m.id === id)?.franchise ?? "their opponent";

  if (!seeds?.length) {
    return regular.some((g) => !g.final)
      ? null
      : { kind: "waiting", message: "The regular season is over. The bracket is drawn as soon as the commissioner closes the last week." };
  }

  const shape = bracketShape(seeds.length);
  const mine = seeds.find((s) => s.manager_id === managerId);
  const champion = champions?.[0];

  if (!mine) {
    return {
      kind: "missed",
      message: placed
        ? `Your season is over. ${finished(placed)}${champion ? ` ${champion.franchise} are the champions.` : ""}`
        : "You missed the playoffs. The consolation bracket decides 7th to last — the last-place team picks first in the rookie draft.",
    };
  }

  if (champion?.manager_id === managerId) {
    return { kind: "champion", message: `Champions. You won the ${season} title as the ${mine.seed} seed.` };
  }

  const playoffs = all.filter((g) => g.playoff && (g.bracket ?? "title") === "title");
  const lost = playoffs.find((g) => {
    if (!g.final || (g.home_manager !== managerId && g.away_manager !== managerId)) return false;
    const winner =
      g.winner ??
      // A level game goes to the better seed.
      [...seeds].filter((s) => s.manager_id === g.home_manager || s.manager_id === g.away_manager).sort((a, b) => a.seed - b.seed)[0]
        ?.manager_id;
    return winner !== managerId;
  });

  if (lost) {
    const by = lost.home_manager === managerId ? lost.away_manager : lost.home_manager;
    return {
      kind: "out",
      message: `Your season is over — knocked out in the ${roundName(lost.playoff_round ?? 1, shape.rounds).toLowerCase()} by ${name(by)}.${
        placed ? ` ${finished(placed)}` : ""
      }${champion ? ` ${champion.franchise} are the champions.` : ""}`,
    };
  }

  const firstWeek = lastRegular + 1;
  if (mine.seed <= shape.byes && week === firstWeek) {
    return {
      kind: "bye",
      message: `First-round bye as the ${mine.seed} seed. You play in week ${firstWeek + 1}, in the ${roundName(2, shape.rounds).toLowerCase()}, against the lowest seed left.`,
    };
  }

  return {
    kind: "alive",
    message: "Still alive. Your next game is drawn as soon as the commissioner closes this round.",
  };
}
