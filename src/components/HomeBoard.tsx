"use client";

import { useCallback, useEffect, useState } from "react";
import LeagueOverview from "./LeagueOverview";
import MatchupBoard from "./MatchupBoard";
import MiniGamesStrip from "./MiniGamesStrip";
import MyTeamBoard from "./MyTeamBoard";
import ScoreTicker from "./ScoreTicker";
import Section from "./Section";
import WeekScoreboard from "./WeekScoreboard";
import type { Home } from "@/lib/home-types";

/**
 * The home page for somebody who is signed in.
 *
 * Everything a manager does in a week is here in the order they do it: the
 * games on the way past, the lineup they came to set, the scoreboard that
 * lineup is playing into, and where they stand. The pages these came from are
 * gone, so each section is the real thing rather than a summary that links
 * somewhere else.
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

      <Section eyebrow="ON THE SIDE" title="Mini-games">
        <MiniGamesStrip />
      </Section>

      <Section eyebrow="YOUR FRANCHISE" title="My lineup">
        <div style={{ margin: "0 -26px" }}>
          <MyTeamBoard embedded />
        </div>
      </Section>

      <Section
        eyebrow="THE LEAGUE"
        title="This week's matchups"
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

        {/* The head-to-head that used to be its own page, in full, because
            there is nowhere else left to see it. */}
        <div style={{ margin: "10px -26px 0" }}>
          <MatchupBoard embedded />
        </div>
      </Section>

      <Section
        eyebrow="WHERE YOU STAND"
        title="League overview"
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
