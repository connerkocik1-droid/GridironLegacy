"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Skeleton from "./Skeleton";
import Standings from "./Standings";
import LeagueChat from "./LeagueChat";
import LeagueRules from "./LeagueRules";
import PlayerRankings from "./PlayerRankings";
import ActivityFeed from "./ActivityFeed";
import LeagueStories from "./LeagueStories";
import LeagueNewsWire from "./LeagueNewsWire";
import { useRefreshable } from "@/lib/use-refresh";
import { seasonPlayers, standings, type Fixture, type Franchise } from "@/lib/league-story";

/**
 * The league, on one screen.
 *
 * The same rearrangement My Team had, for the same reason: this was seven
 * buttons leading to seven pages, which is a table of contents rather than a
 * page. The seven become sections behind a sub-tab strip, and the pages stay
 * where they are because they are linked from everywhere else in the app.
 *
 * Overview first, because it is the only one of the seven that answers "what
 * has happened" rather than "show me the list I asked for".
 */

const TABS = ["Overview", "Standings", "Chat", "Moves", "News", "Ranks", "Rules"] as const;
type Tab = (typeof TABS)[number];

const slugOf = (t: Tab) => t.toLowerCase();
const tabFrom = (slug: string | null): Tab =>
  TABS.find((t) => slugOf(t) === slug) ?? "Overview";

interface Side {
  id: string;
  name: string;
  franchise: string;
  division: string | null;
  points: number | null;
}

interface Schedule {
  meId: string;
  league: { name: string; season: number } | null;
  weeks: number[];
  liveWeek: number | null;
  games: {
    week: number;
    final: boolean;
    home: Side;
    away: Side;
  }[];
}

export default function LeagueTabs() {
  return (
    // The section lives in the query string, which needs a boundary.
    <Suspense fallback={<Skeleton rows={6} />}>
      <Board />
    </Suspense>
  );
}

function Board() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = tabFrom(params.get("tab"));

  const [schedule, setSchedule] = useState<Schedule | null>(null);
  const [totals, setTotals] = useState<Record<string, { total: number; games: number }>>({});
  const [navHeight, setNavHeight] = useState(0);
  const [strip, setStrip] = useState({ left: false, right: false });
  const [stripEl, setStripEl] = useState<HTMLDivElement | null>(null);

  const load = useCallback(async () => {
    // The two tables everything on this page is derived from: who played whom
    // for how many points, and what each player has scored.
    const [sched, ranks] = await Promise.all([
      fetch("/api/schedule", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/rankings", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]);
    if (sched) setSchedule(sched as Schedule);
    if (ranks?.points) setTotals(ranks.points);
  }, []);

  useRefreshable(load);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Where the top of the screen actually is. The nav above wraps to two rows
  // on a narrow phone, so its height is not a constant to hard-code.
  useEffect(() => {
    const nav = document.querySelector(".gl-nav");
    if (!nav) return;
    const measure = () => setNavHeight(nav.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  const measureStrip = useCallback(() => {
    if (!stripEl) return;
    const room = stripEl.scrollWidth - stripEl.clientWidth;
    setStrip({ left: stripEl.scrollLeft > 2, right: stripEl.scrollLeft < room - 2 });
  }, [stripEl]);

  useEffect(() => {
    if (!stripEl) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    measureStrip();
    stripEl
      .querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ inline: "nearest", block: "nearest", behavior: "smooth" });
    const observer = new ResizeObserver(measureStrip);
    observer.observe(stripEl);
    return () => observer.disconnect();
  }, [stripEl, measureStrip, tab]);

  const { rows, players, graded, scored } = useMemo(() => {
    const games = schedule?.games ?? [];

    // One entry per franchise, taken off the fixtures rather than fetched
    // again: every side of every game names its own franchise.
    const seen = new Map<string, Franchise>();
    for (const g of games) {
      for (const s of [g.home, g.away]) {
        if (!seen.has(s.id)) {
          seen.set(s.id, {
            id: s.id,
            franchise: s.franchise,
            owner: s.name,
            division: s.division,
            mine: s.id === schedule?.meId,
          });
        }
      }
    }

    const fixtures: Fixture[] = games.map((g) => ({
      week: g.week,
      home: g.home.id,
      away: g.away.id,
      homePoints: Number(g.home.points ?? 0),
      awayPoints: Number(g.away.points ?? 0),
      final: g.final,
    }));

    const players = seasonPlayers(totals);

    return {
      rows: standings([...seen.values()], fixtures),
      players,
      // Settled into records. What a streak is made of.
      graded: new Set(games.filter((g) => g.final).map((g) => g.week)).size,
      // Weeks anybody has been scored in, which starts on Thursday and does
      // not wait for the week to be graded. Read off the players rather than
      // the fixtures, because scoring is what it is counting.
      scored: players.reduce((n, p) => Math.max(n, p.games), 0),
    };
  }, [schedule, totals]);

  const go = (next: Tab) => {
    const query = next === "Overview" ? "" : `?tab=${slugOf(next)}`;
    router.push(`/the-league${query}`, { scroll: false });
  };

  const season = schedule?.league?.season;
  const week = schedule?.liveWeek;

  return (
    <div style={{ maxWidth: 760, margin: "0 auto" }}>
      <div
        style={{
          position: "sticky",
          top: navHeight,
          zIndex: 10,
          padding: "18px 18px 0",
          background:
            "linear-gradient(180deg,rgb(var(--bg-rgb) / .96) 84%,rgb(var(--bg-rgb) / 0))",
          backdropFilter: "blur(14px)",
          WebkitBackdropFilter: "blur(14px)",
        }}
      >
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
          <h1
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 24,
              letterSpacing: "-.025em",
              margin: 0,
              fontWeight: 500,
              color: "var(--text)",
              overflowWrap: "anywhere",
            }}
          >
            {schedule?.league?.name ?? "The league"}
          </h1>
          <span style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--text-dim)" }}>
            {season ? `${season} SEASON` : ""}
            {week ? ` · WK ${week}` : ""}
          </span>
        </div>

        <div
          role="tablist"
          aria-label="League sections"
          className="gl-noscrollbar"
          ref={setStripEl}
          onScroll={measureStrip}
          style={{
            display: "flex",
            gap: 4,
            overflowX: "auto",
            margin: "14px -18px 0",
            padding: "0 18px 1px",
            scrollPaddingInline: 26,
            maskImage: edgeFade(strip),
            WebkitMaskImage: edgeFade(strip),
          }}
        >
          {TABS.map((t) => {
            const on = t === tab;
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => go(t)}
                style={{
                  cursor: "pointer",
                  flex: "0 0 auto",
                  fontFamily: "inherit",
                  fontSize: 12,
                  letterSpacing: ".04em",
                  minHeight: 36,
                  padding: "8px 10px",
                  borderRadius: "8px 8px 0 0",
                  border: 0,
                  background: on ? "rgb(var(--accent-rgb) / .18)" : "transparent",
                  color: on ? "var(--text)" : "var(--text-dim)",
                  boxShadow: on ? "inset 0 -2px 0 var(--accent-link)" : "none",
                }}
              >
                {t}
              </button>
            );
          })}
        </div>
        <div style={{ height: 1, background: "rgb(var(--accent-rgb) / .2)", margin: "0 -18px" }} />
      </div>

      <div style={{ padding: "14px 0 24px" }}>
        {tab === "Overview" ? (
          <div style={{ padding: "0 18px" }}>
            {!schedule ? (
              <Skeleton rows={4} />
            ) : (
              <LeagueStories rows={rows} players={players} graded={graded} scored={scored} />
            )}
          </div>
        ) : null}

        {tab === "Standings" ? <Standings embedded /> : null}
        {tab === "Chat" ? <LeagueChat /> : null}

        {tab === "Moves" ? (
          <div style={{ padding: "0 18px" }}>
            <ActivityFeed />
          </div>
        ) : null}

        {tab === "News" ? (
          <div style={{ padding: "0 18px" }}>
            <LeagueNewsWire rows={rows} players={players} weeks={Math.max(graded, scored)} />
          </div>
        ) : null}

        {tab === "Ranks" ? <PlayerRankings /> : null}
        {tab === "Rules" ? <LeagueRules embedded /> : null}
      </div>
    </div>
  );
}

/** Fades only the edges that have something behind them. */
function edgeFade({ left, right }: { left: boolean; right: boolean }): string | undefined {
  if (!left && !right) return undefined;
  const from = left ? "transparent 0,#000 26px" : "#000 0";
  const to = right ? "#000 calc(100% - 26px),transparent 100%" : "#000 100%";
  return `linear-gradient(90deg,${from},${to})`;
}
