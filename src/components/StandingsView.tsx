"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { records, type RecordGame, type Records } from "@/lib/records";
import { useLogos } from "@/lib/use-logos";
import { useRefreshable } from "@/lib/use-refresh";
import TeamCrest from "./TeamCrest";
import { AppView, GroupSkeleton, Note, RowGroup, type RowSpec } from "./RowList";

interface Franchise {
  id: string;
  slot: string;
  name: string;
  franchise: string;
  division: string | null;
  claimed: boolean;
  pointsFor: number;
  record: { wins: number; losses: number; ties: number } | null;
}

interface League {
  meId: string;
  franchises: Franchise[];
}

interface PlayoffSide {
  id: string;
  franchise: string;
  seed: number | null;
  mine: boolean;
  points: number;
}

interface Playoffs {
  seeded: boolean;
  season: number | null;
  totalRounds?: number;
  champions: { season: number; franchise: string }[];
  rounds?: { round: number; games: { id: string; week: number; final: boolean; winner: string | null; home: PlayoffSide; away: PlayoffSide }[] }[];
}

const pct = (r: Franchise["record"]) => {
  if (!r) return 0;
  const g = r.wins + r.losses + r.ties;
  return g ? (r.wins + r.ties / 2) / g : 0;
};

const roundName = (round: number, total: number) =>
  total - round === 0 ? "FINAL" : total - round === 1 ? "SEMI-FINALS" : total - round === 2 ? "QUARTER-FINALS" : `ROUND ${round}`;

/**
 * The League → Standings: one table per division, record first and points
 * scored to break a tie, with games behind the leader. Under it, once there
 * is one, the playoff bracket round by round, and the season's records. From
 * the Standings view in prototype/Pylon App.dc.html.
 */
export default function StandingsView() {
  const logos = useLogos();
  const [league, setLeague] = useState<League | null>(null);
  const [playoffs, setPlayoffs] = useState<Playoffs | null>(null);
  const [season, setSeason] = useState<Records | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [lg, po, sc] = await Promise.all([
      fetch("/api/league", { cache: "no-store" }).then((r) => (r.ok ? r.json() : r.status === 401 ? "signin" : null)).catch(() => null),
      fetch("/api/playoffs", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch("/api/schedule", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]);
    if (lg === "signin") return setError("Sign in to see the standings.");
    if (!lg) return setError("Could not read the league.");
    setLeague(lg as League);
    setPlayoffs(po as Playoffs | null);
    setSeason(sc ? records((sc as { games?: RecordGame[] }).games ?? []) : null);
    setError(null);
  }, []);

  useRefreshable(load);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const t = setInterval(() => void load(), 60_000);
    return () => clearInterval(t);
  }, [load]);

  const divisions = useMemo(() => {
    const groups = new Map<string, Franchise[]>();
    for (const f of league?.franchises ?? []) {
      const key = f.division ?? "League";
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }
    for (const list of groups.values()) list.sort((a, b) => pct(b.record) - pct(a.record) || b.pointsFor - a.pointsFor);
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [league]);

  if (error && !league) {
    return (
      <AppView>
        <Note tag="STANDINGS" tone="warn">{error}</Note>
      </AppView>
    );
  }
  if (!league) {
    return (
      <AppView>
        <GroupSkeleton rows={5} />
        <GroupSkeleton rows={5} />
      </AppView>
    );
  }

  const crest = (id: string, franchise: string, slot?: string) => (
    <TeamCrest franchise={franchise} logo={logos[id] ?? (slot ? logos[slot] : undefined) ?? null} size={26} shape="box" />
  );

  const total = playoffs?.totalRounds ?? playoffs?.rounds?.length ?? 0;
  const champion = playoffs?.champions.find((c) => c.season === playoffs.season);
  const past = (playoffs?.champions ?? []).filter((c) => c.season !== playoffs?.season);

  const seasonRows: RowSpec[] = [];
  if (season && season.played > 0) {
    if (season.highest)
      seasonRows.push({ key: "hi", title: season.highest.franchise, sub: `Highest score · week ${season.highest.week}`, val: season.highest.points.toFixed(1), bigVal: true, valColor: "var(--ap-a200)" });
    if (season.biggest)
      seasonRows.push({ key: "big", title: `${season.biggest.winner} over ${season.biggest.loser}`, sub: `Biggest win · week ${season.biggest.week}`, val: `+${season.biggest.margin.toFixed(1)}`, bigVal: true });
    if (season.closest)
      seasonRows.push({ key: "close", title: `${season.closest.winner} over ${season.closest.loser}`, sub: `Closest · week ${season.closest.week}`, val: `+${season.closest.margin.toFixed(1)}`, bigVal: true });
    if (season.unluckiest && season.highest && season.unluckiest.points < season.highest.points)
      seasonRows.push({ key: "unlucky", title: season.unluckiest.franchise, sub: `Most in a loss · week ${season.unluckiest.week}`, val: season.unluckiest.points.toFixed(1), bigVal: true });
    if (season.streak)
      seasonRows.push({
        key: "streak",
        title: season.streak.franchise,
        sub: season.streak.run > 0 ? "On a run" : "In a slump",
        val: `${Math.abs(season.streak.run)} ${season.streak.run > 0 ? "W" : "L"}`,
        bigVal: true,
      });
  }

  return (
    <AppView>
      {divisions.map(([division, teams]) => {
        const lead = teams[0]?.record;
        return (
          <RowGroup
            key={division}
            label={division.toUpperCase()}
            note="W-L · PF"
            rows={teams.map((t, i) => {
              const r = t.record;
              const gb = lead && r ? (lead.wins - r.wins + (r.losses - lead.losses)) / 2 : 0;
              const mine = t.id === league.meId;
              return {
                key: t.id,
                num: i + 1,
                lit: i === 0,
                hi: mine,
                logo: crest(t.id, t.franchise, t.slot),
                title: t.franchise,
                sub: `${t.claimed ? t.name.split(" ")[0] : "Open"}${i === 0 ? " · division lead" : ` · ${gb % 1 ? gb.toFixed(1) : gb} GB`}`,
                val: r ? `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}` : "0-0",
                valSub: `${t.pointsFor.toFixed(1)} PF`,
                href: `/team/${t.id}`,
              };
            })}
          />
        );
      })}

      {playoffs?.seeded
        ? (playoffs.rounds ?? []).map(({ round, games }) => (
            <RowGroup
              key={`r${round}`}
              label={roundName(round, total)}
              note={games[0] ? `WEEK ${games[0].week}` : undefined}
              rows={games.flatMap((g) =>
                [g.home, g.away].map((s, j) => {
                  const won = g.final && g.winner === s.id;
                  return {
                    key: `${g.id}:${j}`,
                    num: s.seed ?? undefined,
                    hi: s.mine,
                    tight: true,
                    logo: crest(s.id, s.franchise),
                    title: s.franchise,
                    sub: j === 1 ? undefined : g.final ? "Final" : "In progress",
                    val: s.points.toFixed(1),
                    valColor: won ? "var(--good)" : g.final ? "var(--ap-n500)" : undefined,
                  };
                }),
              )}
            />
          ))
        : null}
      {champion ? <Note tag="CHAMPIONS">{champion.franchise} are champions.</Note> : null}

      {seasonRows.length ? <RowGroup label="THE SEASON SO FAR" rows={seasonRows} /> : null}

      {past.length ? (
        <RowGroup
          label="CHAMPIONS"
          note={`${past.length} season${past.length === 1 ? "" : "s"}`}
          rows={past.map((c) => ({ key: String(c.season), title: c.franchise, val: String(c.season), valColor: "var(--ap-a200)" }))}
        />
      ) : null}
    </AppView>
  );
}
