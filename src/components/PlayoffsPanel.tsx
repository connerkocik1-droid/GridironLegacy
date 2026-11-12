"use client";

import type { ReactNode } from "react";
import { roundName } from "@/lib/playoff-picture";
import { Note, RowGroup, type RowSpec, type RowTag } from "./RowList";

export interface PlayoffSide {
  id: string;
  franchise: string;
  seed: number | null;
  mine: boolean;
  points?: number;
}

interface PictureRow extends PlayoffSide {
  seed: number;
  inField: boolean;
  bye: boolean;
  divisionLeader: boolean;
  status: "bye" | "division" | "clinched" | "in" | "out" | "eliminated";
  mark: "z" | "y" | "x" | "e" | null;
  behind: number | null;
  division: string | null;
  record: { wins: number; losses: number; ties: number };
}

interface BracketGame {
  id: string;
  week: number;
  final: boolean;
  winner: string | null;
  onSeed?: boolean;
  /** A placement or consolation game's round and the place it decides. */
  round?: number;
  forPlace?: number | null;
  home: PlayoffSide;
  away: PlayoffSide;
}

export interface Playoffs {
  seeded: boolean;
  season: number | null;
  champions: { season: number; franchise: string; manager_id?: string }[];
  picture?: {
    field: number;
    rounds: number;
    byes: number;
    regularWeeks: number;
    weeksLeft: number;
    rows: PictureRow[];
    firstRound: { week: number; home: PlayoffSide; away: PlayoffSide }[];
    consolation: { home: PlayoffSide; away: PlayoffSide }[];
  };
  // Once the bracket is drawn.
  field?: number;
  rounds?: number;
  byes?: number;
  roundWeeks?: (number | null)[];
  seeds?: (PlayoffSide & { seed: number; bye: boolean; status: "alive" | "out" | "champion"; outIn: number | null })[];
  /** The rounds drawn so far, with their games. */
  drawn?: { round: number; games: BracketGame[] }[];
  placement?: BracketGame[];
  consolation?: BracketGame[];
  consolationSeeds?: (PlayoffSide & { seed: number })[];
  /** The final order, once the last game is done. */
  finish?: (PlayoffSide & { place: number })[];
}

const record = (r: PictureRow["record"]) => `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}`;
const ordinal = (n: number) => `${n}${["th", "st", "nd", "rd"][n % 100 >= 11 && n % 100 <= 13 ? 0 : n % 10 < 4 ? n % 10 : 0]}`;

const MARK: Record<NonNullable<PictureRow["mark"]>, RowTag> = {
  z: { label: "BYE ✓", tone: "live" },
  y: { label: "DIV ✓", tone: "live" },
  x: { label: "IN ✓", tone: "live" },
  e: { label: "OUT", tone: "flat" },
};

/**
 * The Standings page's playoff section.
 *
 * Before the bracket: the picture if the season ended today — the field with
 * its byes and wild cards, who is on the outside and how far, the first round
 * it would make, and a mark beside every team whose fate is already certain.
 * After: the bracket itself, every round named from the end, the byes in the
 * first, the rounds still to be drawn shown as what they will be, and the
 * champion once there is one.
 */
export default function PlayoffsPanel({ playoffs, crest }: { playoffs: Playoffs; crest: (id: string, franchise: string) => ReactNode }) {
  if (playoffs.seeded) return <Bracket playoffs={playoffs} crest={crest} />;
  if (playoffs.picture) return <Picture picture={playoffs.picture} crest={crest} />;
  return null;
}

function Picture({ picture, crest }: { picture: NonNullable<Playoffs["picture"]>; crest: (id: string, franchise: string) => ReactNode }) {
  const inField = picture.rows.filter((r) => r.inField);
  const outside = picture.rows.filter((r) => !r.inField);
  const opponentOf = new Map<string, PlayoffSide>();
  for (const g of picture.firstRound) {
    opponentOf.set(g.home.id, g.away);
    opponentOf.set(g.away.id, g.home);
  }

  const row = (r: PictureRow): RowSpec => {
    const opp = opponentOf.get(r.id);
    const sub = !r.inField
      ? r.status === "eliminated"
        ? "Eliminated"
        : r.behind
          ? `${r.behind % 1 ? r.behind.toFixed(1) : r.behind} ${r.behind === 1 ? "win" : "wins"} behind the last seed`
          : "Level with the last seed — on the tiebreak"
      : r.bye
        ? `${r.divisionLeader ? `Leads the ${r.division ?? "division"} · ` : ""}first-round bye`
        : `${r.divisionLeader ? `Leads the ${r.division ?? "division"}` : "Wild card"}${opp ? ` · v ${opp.seed} ${opp.franchise}` : ""}`;
    return {
      key: r.id,
      num: r.seed,
      lit: r.inField,
      hi: r.mine,
      logo: crest(r.id, r.franchise),
      title: r.franchise,
      tags: r.mark ? [MARK[r.mark]] : undefined,
      sub,
      val: record(r.record),
      href: `/team/${r.id}`,
    };
  };

  const weeks = picture.weeksLeft;
  return (
    <>
      <Note tag="PLAYOFF PICTURE">
        {weeks > 0
          ? `If the season ended today. ${weeks} ${weeks === 1 ? "week" : "weeks"} left; the top ${picture.field} make it${
              picture.byes ? ` and the top ${picture.byes} sit out the first round` : ""
            }. Division winners take the top seeds.`
          : `The regular season is over. The bracket is drawn when the last week is closed.`}
      </Note>
      <RowGroup label="IN THE FIELD" note={`TOP ${picture.field}`} rows={inField.map(row)} />
      {outside.length ? <RowGroup label="ON THE OUTSIDE" rows={outside.map(row)} /> : null}
      <RowGroup
        label={`${roundName(1, picture.rounds).toUpperCase()} · WEEK ${picture.firstRound[0]?.week ?? picture.regularWeeks + 1}`}
        note="IF IT ENDED TODAY"
        rows={[
          ...inField
            .filter((r) => r.bye)
            .map((r) => ({
              key: `bye:${r.id}`,
              num: r.seed,
              hi: r.mine,
              tight: true,
              logo: crest(r.id, r.franchise),
              title: r.franchise,
              sub: `Bye · into the ${roundName(2, picture.rounds).toLowerCase()}`,
            })),
          ...picture.firstRound.flatMap((g, i) =>
            [g.home, g.away].map((s, j) => ({
              key: `g${i}:${j}`,
              num: s.seed ?? undefined,
              hi: s.mine,
              tight: true,
              logo: crest(s.id, s.franchise),
              title: s.franchise,
              sub: j === 0 ? `Hosts the ${s.seed && g.away.seed ? ordinal(g.away.seed) : "lower"} seed` : undefined,
            })),
          ),
        ]}
      />
      {picture.consolation.length ? (
        <RowGroup
          label={`CONSOLATION · WEEK ${picture.regularWeeks + 1}`}
          note="IF IT ENDED TODAY"
          rows={picture.consolation.flatMap((g, i) =>
            [g.home, g.away].map((s, j) => ({
              key: `c${i}:${j}`,
              num: s.seed ?? undefined,
              hi: s.mine,
              tight: true,
              logo: crest(s.id, s.franchise),
              title: s.franchise,
              sub: j === 0 && i === 0 ? "Losers play on — the last one left finishes last and picks first" : undefined,
            })),
          )}
        />
      ) : null}
      <p style={{ fontSize: 11, color: "var(--ap-n500)", lineHeight: 1.6, margin: "-4px 4px 0" }}>
        BYE ✓ clinched a first-round bye · DIV ✓ clinched the division · IN ✓ clinched a playoff place · OUT eliminated. Marks are
        only given once nothing left to play can change them.
      </p>
    </>
  );
}

function Bracket({ playoffs, crest }: { playoffs: Playoffs; crest: (id: string, franchise: string) => ReactNode }) {
  const rounds = playoffs.rounds ?? 1;
  const seeds = playoffs.seeds ?? [];
  const drawn = new Map((playoffs.drawn ?? []).map((r) => [r.round, r.games]));
  const champion = playoffs.champions.find((c) => c.season === playoffs.season);
  const mine = seeds.find((s) => s.mine);
  const finish = playoffs.finish ?? [];
  const total = finish.length || seeds.length + (playoffs.consolationSeeds?.length ?? 0);
  const myPlace = finish.find((f) => f.mine)?.place;
  const inConsolation = (playoffs.consolationSeeds ?? []).find((s) => s.mine);
  const placeLabel = (g: BracketGame) =>
    g.forPlace == null
      ? `First round · winners play for ${ordinal(seeds.length + 1)}, losers for last`
      : `For ${ordinal(g.forPlace)}${g.forPlace + 1 === total ? " · the loser finishes last" : ""}`;

  const gameRows = (g: BracketGame, label?: string): RowSpec[] =>
    [g.home, g.away].map((s, j) => {
      const won = g.final && g.winner === s.id;
      const lost = g.final && g.winner != null && g.winner !== s.id;
      return {
        key: `${g.id}:${j}`,
        num: s.seed ?? undefined,
        hi: s.mine,
        tight: true,
        logo: crest(s.id, s.franchise),
        title: s.franchise,
        titleColor: lost ? "var(--ap-n500)" : undefined,
        tags: won ? [{ label: "WON", tone: "live" as const }] : undefined,
        sub:
          j === 0
            ? `${label ? `${label} · ` : ""}${g.final ? (g.onSeed ? "Final · level, the better seed goes through" : "Final") : `Week ${g.week}`}`
            : undefined,
        val: (s.points ?? 0).toFixed(1),
        valColor: won ? "var(--good)" : lost ? "var(--ap-n500)" : undefined,
        href: `/matchup?week=${g.week}&home=${s.id}`,
      };
    });

  return (
    <>
      {champion ? (
        <Note tag={`${playoffs.season} CHAMPIONS`}>
          {champion.franchise} are the champions{mine?.status === "champion" ? " — that's you" : ""}.
          {myPlace && mine?.status !== "champion" ? ` You finished ${ordinal(myPlace)}.` : ""}
        </Note>
      ) : inConsolation ? (
        <Note tag="YOUR POSTSEASON">
          You missed the playoffs, so you&apos;re in the consolation bracket: win and you play for{" "}
          {ordinal(seeds.length + 1)}; lose twice and you finish last — which earns the first pick in the rookie draft.
        </Note>
      ) : mine ? (
        <Note tag="YOUR PLAYOFFS">
          {mine.status === "out"
            ? `Knocked out in the ${roundName(mine.outIn ?? 1, rounds).toLowerCase()} as the ${ordinal(mine.seed)} seed.`
            : mine.bye && !drawn.has(2)
              ? `${ordinal(mine.seed)} seed, with a first-round bye — you play in the ${roundName(2, rounds).toLowerCase()}.`
              : `${ordinal(mine.seed)} seed and still alive.`}
        </Note>
      ) : null}

      {finish.length ? (
        <RowGroup
          label="FINAL STANDINGS"
          note="ROOKIE DRAFT ORDER"
          rows={finish.map((f) => ({
            key: `fin:${f.id}`,
            num: f.place,
            lit: f.place === 1,
            hi: f.mine,
            tight: true,
            logo: crest(f.id, f.franchise),
            title: f.franchise,
            sub: f.place === 1 ? "Champions" : f.place === total ? "Last place" : undefined,
            val: `Pick ${total + 1 - f.place}`,
          }))}
        />
      ) : null}

      {Array.from({ length: rounds }, (_, i) => i + 1).map((round) => {
        const games = drawn.get(round) ?? [];
        const week = playoffs.roundWeeks?.[round - 1];
        const label = `${roundName(round, rounds).toUpperCase()}${week ? ` · WEEK ${week}` : ""}`;
        const byes = round === 1 ? seeds.filter((s) => s.bye) : [];
        if (games.length) {
          return (
            <RowGroup
              key={round}
              label={label}
              rows={[
                ...games.flatMap((g) => gameRows(g)),
                ...byes.map((s) => ({
                  key: `bye:${s.id}`,
                  num: s.seed,
                  hi: s.mine,
                  tight: true,
                  logo: crest(s.id, s.franchise),
                  title: s.franchise,
                  sub: `Bye · into the ${roundName(2, rounds).toLowerCase()}`,
                })),
              ]}
            />
          );
        }
        // Not drawn yet: say what it will be. Each round reseeds, so who plays
        // whom is only known once the round before it is over.
        const count = 2 ** (rounds - round);
        return (
          <RowGroup
            key={round}
            label={label}
            note="TO BE DRAWN"
            rows={Array.from({ length: count }, (_, k) => ({
              key: `tbd:${round}:${k}`,
              tight: true,
              title: round === rounds ? "The last two standing" : k === 0 ? "Best seed left v lowest seed left" : "The two in between",
              sub: "Drawn when the round before it ends",
            }))}
          />
        );
      })}

      {playoffs.placement?.length ? (
        <RowGroup label="PLACEMENT GAMES" rows={playoffs.placement.flatMap((g) => gameRows(g, placeLabel(g)))} />
      ) : null}

      {playoffs.consolation?.length ? (
        <RowGroup label="CONSOLATION" note="LOSERS ADVANCE" rows={playoffs.consolation.flatMap((g) => gameRows(g, placeLabel(g)))} />
      ) : null}

      <RowGroup
        label="THE FIELD"
        note={`${seeds.length} TEAMS`}
        rows={seeds.map((s) => ({
          key: s.id,
          num: s.seed,
          hi: s.mine,
          tight: true,
          logo: crest(s.id, s.franchise),
          title: s.franchise,
          titleColor: s.status === "out" ? "var(--ap-n500)" : undefined,
          tags: s.status === "champion" ? [{ label: "CHAMPION", tone: "live" as const }] : s.status === "out" ? [{ label: "OUT", tone: "flat" as const }] : undefined,
          sub:
            s.status === "out"
              ? `Out in the ${roundName(s.outIn ?? 1, rounds).toLowerCase()}`
              : s.status === "champion"
                ? "Champions"
                : s.bye && !drawn.has(2)
                  ? "First-round bye"
                  : "Still alive",
          href: `/team/${s.id}`,
        }))}
      />
    </>
  );
}
