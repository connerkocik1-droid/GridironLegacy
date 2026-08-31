"use client";

import { useCallback, useEffect, useState } from "react";
import ActivityFeed from "./ActivityFeed";
import HomeButtons from "./HomeButtons";
import LeagueOverview from "./LeagueOverview";
import MiniGamesStrip from "./MiniGamesStrip";
import ScoreTicker from "./ScoreTicker";
import Section from "./Section";
import WeekScoreboard from "./WeekScoreboard";
import type { Home } from "@/lib/home-types";

/**
 * The home page for somebody who is signed in.
 *
 * The way in to everything, rather than everything at once: four places a
 * manager goes, this week's scoreboard so the front page is never stale, the
 * games on the side, and where the league stands. The work itself happens on
 * the pages the buttons lead to, which keeps this one readable on a phone
 * during a Sunday.
 */
export default function HomeBoard() {
  const [home, setHome] = useState<Home | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/home", { cache: "no-store" });
      if (res.status === 401) return setError("Sign in to see your league.");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error ?? "Could not read the league.");
      }
      setHome(await res.json());
      setError(null);
    } catch {
      setError("Could not read the league.");
    }
  }, []);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    // The same minute the lineup and matchup panels use, so the three never
    // drift into showing different points for the same player.
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  return (
    <div style={{ paddingBottom: 44 }}>
      {/* Above everything, because it is the one thing on this page that is
          about the actual football rather than the league. */}
      <ScoreTicker />

      <Section eyebrow="THE LEAGUE" title="Where to" collapseId="home.where">
        <HomeButtons lineupProblems={home?.lineupProblems ?? 0} />
      </Section>

      <Section
        eyebrow="RIGHT NOW"
        title="This week"
        collapseId="home.week"
        aside={
          home?.week != null
            ? `Week ${home.week}${home.live ? " · live" : " · projected"}`
            : undefined
        }
      >
        {error && !home ? (
          <div style={{ fontSize: 12.5, color: "#e0b573" }}>{error}</div>
        ) : !home ? (
          <div style={{ fontSize: 12.5, color: "#75798c" }}>Reading the league…</div>
        ) : (
          <WeekScoreboard games={home.games} byes={home.byes} live={home.live} />
        )}
      </Section>

      {/* Between the week and the standings, because it is the answer to the
          question the standings make you ask: how did that roster get like
          that. Five rows here; the rest is a page. */}
      <Section eyebrow="COMINGS AND GOINGS" title="Recent moves" collapseId="home.moves">
        <ActivityFeed limit={5} />
      </Section>

      <Section eyebrow="ON THE SIDE" title="Mini-games" collapseId="home.games">
        <MiniGamesStrip />
      </Section>

      <Section
        eyebrow="WHERE YOU STAND"
        title="League overview"
        collapseId="home.standing"
        aside={home?.played ? undefined : "Nothing graded yet — ranked on points alone."}
      >
        {home ? (
          <LeagueOverview home={home} />
        ) : (
          <div style={{ fontSize: 12.5, color: "#75798c" }}>Reading the league…</div>
        )}
      </Section>
    </div>
  );
}
