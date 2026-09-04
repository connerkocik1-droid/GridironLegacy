"use client";

import { useCallback, useEffect, useState } from "react";
import DraftBand from "./DraftBand";
import MatchupBand from "./MatchupBand";
import Section from "./Section";
import MyTeamButton from "./MyTeamButton";
import TradeAsks from "./TradeAsks";
import TheLeagueButton from "./TheLeagueButton";
import MiniGamesButton from "./MiniGamesButton";
import ScoreTicker from "./ScoreTicker";
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
  }, [load]);

  // How hard to chase the score, decided by whether there is a score to chase.
  // Half a minute while the ball is in the air; five minutes in February, when
  // asking more often would only wake the server up to tell it nothing has
  // happened since 1997.
  const phase = home?.weekPhase ?? "upcoming";
  const every = phase === "live" ? 30_000 : phase === "final" ? 120_000 : 300_000;

  useEffect(() => {
    const timer = setInterval(() => {
      // A phone left on this page overnight should not spend the night
      // pulling box scores nobody is reading.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void load();
    }, every);
    return () => clearInterval(timer);
  }, [load, every]);

  return (
    <div style={{ paddingBottom: 44 }}>
      {/* Above everything, because it is the one thing on this page that is
          about the actual football rather than the league. */}
      <ScoreTicker />

      {/* First of all, because on a Sunday it is the only question anybody
          has. Not collapsible: a band you can fold away is a band somebody
          folds away once and then wonders where their score went. */}
      <Section eyebrow="YOUR GAME" title="This matchup">
        {/* Above the matchup for as long as there is a draft to come: before
            the schedule exists there is no matchup, and draft night is the
            only thing happening in this league. It removes itself afterwards. */}
        <DraftBand home={home} />

        {error && !home ? (
          <div style={{ fontSize: 12.5, color: "var(--warn)" }}>{error}</div>
        ) : (
          <MatchupBand home={home} />
        )}

        {/* Directly under the score, because a trade is the other thing that
            changes what that score will be — and because an offer nobody is
            told about is an offer nobody answers. */}
        <TradeAsks trades={home?.trades ?? []} />
      </Section>

      {/* Three doors, directly under the score, because the score is what
          raises every question any of them answers. Yours first: on a Sunday
          what a manager wants is almost always their own.

          Nothing below them any more. The bands that used to be here — this
          week's fixtures, the recent moves — are behind the doors now, and a
          home page you can read without scrolling is the point of the whole
          rearrangement.

          Two of them are hidden on a phone. Since the tab bar arrived, My Team
          and The League are a thumb's reach away on every screen in the app,
          and repeating them here cost three hundred and fifty pixels — most of
          a phone screen — of the page a manager opens more than any other, to
          say something the bottom of that same screen was already saying. They
          stay on a desktop, where the room exists and the top bar's links are
          small. Mini-games is in neither bar, so its door is the only way in
          and it keeps it. */}
      {/* The same left edge as every band above them. The doors were written
          full-bleed and read as a set that way; with two of them hidden on a
          phone the one that is left was a card wider than everything else on
          the page, which looks like a mistake rather than a decision. */}
      <div style={{ padding: "0 26px" }}>
        <div className="gl-home-doors">
          <MyTeamButton />
          <TheLeagueButton />
        </div>
        <MiniGamesButton />
      </div>
    </div>
  );
}
