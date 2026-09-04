"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { DEFENSE_RULES, POINTS_ALLOWED, SCORING_RULES } from "@/lib/scoring";
import { describeClock, readPickClock } from "@/lib/draft-clock";

/**
 * How this league works, for the eleven people who did not build it.
 *
 * Everything else in the app assumes you already know: what a flex slot
 * takes, when a lineup locks, how long a waiver sits, what a defence is worth
 * for a shutout. A manager who knows fantasy football can work most of it out by
 * poking around, and a manager who does not is left guessing on the one night
 * of the year it matters.
 *
 * Every number on this page is read from the league's own settings and from
 * the scoring table the scorer itself uses. That is the whole design: a rules
 * page written by hand is a rules page that is wrong by week four, and wrong
 * in the worst way — confidently, in print, about the thing somebody is about
 * to act on. If the commissioner shortens the waiver period, this page says so
 * the moment they do.
 */

interface Settings {
  starters?: Record<string, number>;
  bench?: number;
  ir?: number;
  rounds?: number;
  scoring?: string;
  regularWeeks?: number;
  waiverDays?: number;
  tradeDeadlineWeek?: number;
  pickClock?: unknown;
  pickSeconds?: unknown;
}

interface Feed {
  league: { name: string; season: number; settings: Settings } | null;
  /** The route calls them franchises, and a league with none is still a page. */
  franchises?: { id: string }[];
}

const card: React.CSSProperties = {
  border: "1px solid rgba(145,132,217,.22)",
  borderRadius: "var(--radius-lg)",
  background: "rgba(26,28,43,.55)",
  padding: "16px 18px",
  marginBottom: 14,
};

const eyebrow: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: ".2em",
  color: "#75798c",
  marginBottom: 10,
};

const body: React.CSSProperties = {
  fontSize: 12.5,
  color: "#9397ab",
  lineHeight: 1.7,
  margin: "0 0 10px",
};

/** One rule: what it is on the left, what it is worth on the right. */
function Rule({ what, worth }: { what: string; worth: string }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        justifyContent: "space-between",
        gap: 12,
        padding: "6px 0",
        borderTop: "1px solid rgba(145,132,217,.12)",
        fontSize: 12.5,
      }}
    >
      <span style={{ color: "#c8ccdc", minWidth: 0 }}>{what}</span>
      <span
        style={{
          color: "#e9e9ed",
          fontVariantNumeric: "tabular-nums",
          flex: "0 0 auto",
          fontFamily: "var(--font-heading)",
        }}
      >
        {worth}
      </span>
    </div>
  );
}

/** "+4" rather than "4", because a minus needs a plus to be read against. */
const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

/** The plural of a count, without the "1 weeks" that gives a page away. */
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export default function LeagueRules() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/league", { cache: "no-store" });
      if (res.status === 401) return setError("Sign in to see the league's rules.");
      if (!res.ok) return setError("Could not read the league.");
      setFeed(await res.json());
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

  if (error) {
    return (
      <div style={{ maxWidth: 700, margin: "40px auto", padding: "0 18px", fontSize: 12.5, color: "#e0b573" }}>
        {error}
      </div>
    );
  }
  if (!feed) {
    return (
      <div style={{ maxWidth: 700, margin: "40px auto", padding: "0 18px", fontSize: 12.5, color: "#75798c" }}>
        Reading the rules…
      </div>
    );
  }

  const settings = feed.league?.settings ?? {};
  const starters = settings.starters ?? {};
  const teams = feed.franchises?.length ?? 0;

  // The lineup in the order it is fielded, counted rather than listed twice —
  // "2 RB" reads better than "RB, RB" and is what a manager is checking for.
  const ORDER = ["QB", "RB", "WR", "TE", "FLEX", "K", "D/ST"];
  const lineup = ORDER.filter((slot) => (starters[slot] ?? 0) > 0);
  const startersTotal = lineup.reduce((n, slot) => n + (starters[slot] ?? 0), 0);

  const ppr =
    settings.scoring === "ppr" ? 1 : settings.scoring === "standard" ? 0 : 0.5;

  const clock = readPickClock(settings);
  const deadline = Number(settings.tradeDeadlineWeek ?? 0);
  const waiverDays = Number(settings.waiverDays ?? 1);
  const regularWeeks = Number(settings.regularWeeks ?? 16);

  return (
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "0 18px 44px" }}>
      <div style={{ ...eyebrow, margin: "26px 0 6px" }}>HOW THIS LEAGUE WORKS</div>
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 28,
          letterSpacing: "-.025em",
          margin: "0 0 10px",
          fontWeight: 500,
          color: "#e9e9ed",
        }}
      >
        {feed.league?.name ?? "The league"}
      </h1>
      <p style={{ ...body, marginBottom: 20 }}>
        {teams > 0 ? `${plural(teams, "manager")}, one franchise each. ` : ""}
        The {feed.league?.season ?? ""} season. Every number on this page is read
        from the league&rsquo;s own settings — if the commissioner changes a rule,
        it changes here too.
      </p>

      {/* ------------------------------------------------------- the lineup --- */}
      <div style={card}>
        <div style={eyebrow}>WHAT YOU FIELD EACH WEEK</div>
        <p style={body}>
          {plural(startersTotal, "starter")}, {plural(Number(settings.bench ?? 0), "bench spot")}
          {settings.ir ? `, and ${plural(Number(settings.ir), "injured-reserve spot")}` : ""}.
          A player locks the moment his own game kicks off — you can change
          anybody whose game has not started, right up to the whistle.
        </p>
        {lineup.map((slot) => (
          <Rule
            key={slot}
            what={
              slot === "FLEX"
                ? "FLEX — a running back, receiver or tight end"
                : slot === "D/ST"
                  ? "D/ST — a whole defence, not a player"
                  : slot
            }
            worth={`×${starters[slot]}`}
          />
        ))}
      </div>

      {/* ------------------------------------------------------ the scoring --- */}
      <div style={card}>
        <div style={eyebrow}>HOW POINTS ARE SCORED</div>
        <p style={body}>
          {ppr === 1
            ? "Full PPR: every catch is a point."
            : ppr === 0
              ? "Standard: catches are worth nothing on their own."
              : "Half PPR: every catch is worth half a point."}{" "}
          Yardage is counted as it falls — no rounding up at the end of a game.
        </p>
        <Rule what="Every 25 passing yards" worth={signed(1)} />
        <Rule what="Passing touchdown" worth={signed(SCORING_RULES.passTd)} />
        <Rule what="Interception thrown" worth={signed(SCORING_RULES.interception)} />
        <Rule what="Every 10 rushing or receiving yards" worth={signed(1)} />
        <Rule what="Rushing or receiving touchdown" worth={signed(SCORING_RULES.rushRecTd)} />
        {ppr > 0 ? <Rule what="Catch" worth={signed(ppr)} /> : null}
        <Rule what="Two-point conversion" worth={signed(SCORING_RULES.twoPoint)} />
        <Rule what="Fumble lost" worth={signed(SCORING_RULES.fumbleLost)} />
      </div>

      {/* ------------------------------------------------------ the kicker --- */}
      <div style={card}>
        <div style={eyebrow}>KICKERS</div>
        <p style={body}>
          A long field goal is worth more than a short one, and a miss costs
          you — which is why a kicker is a real decision rather than a slot you
          fill and forget.
        </p>
        <Rule what="Field goal under 50 yards" worth={signed(SCORING_RULES.fgUnder50)} />
        <Rule what="Field goal of 50 yards or more" worth={signed(SCORING_RULES.fg50Plus)} />
        <Rule what="Field goal missed" worth={signed(SCORING_RULES.fgMissed)} />
        <Rule what="Extra point" worth={signed(SCORING_RULES.xp)} />
        <Rule what="Extra point missed" worth={signed(SCORING_RULES.xpMissed)} />
      </div>

      {/* ----------------------------------------------------- the defence --- */}
      <div style={card}>
        <div style={eyebrow}>DEFENCE AND SPECIAL TEAMS</div>
        <p style={body}>
          You start a whole unit, not a player. Most of its score is what it
          gave up: the bands below are the largest single term in a defensive
          week, which is why a defence facing a bad offence is worth reaching
          for.
        </p>
        <Rule what="Sack" worth={signed(DEFENSE_RULES.sack)} />
        <Rule what="Interception" worth={signed(DEFENSE_RULES.interception)} />
        <Rule what="Fumble recovered" worth={signed(DEFENSE_RULES.fumbleRecovery)} />
        <Rule what="Safety" worth={signed(DEFENSE_RULES.safety)} />
        <Rule what="Touchdown, including a return" worth={signed(DEFENSE_RULES.touchdown)} />

        <div style={{ ...eyebrow, margin: "16px 0 0" }}>POINTS ALLOWED</div>
        {POINTS_ALLOWED.map(([max, points], i) => {
          const low = i === 0 ? 0 : POINTS_ALLOWED[i - 1][0] + 1;
          const label =
            max === Infinity ? `${low} or more` : low === max ? `${max}` : `${low}–${max}`;
          return <Rule key={String(max)} what={`${label} allowed`} worth={signed(points)} />;
        })}
      </div>

      {/* ------------------------------------------------------ the season --- */}
      <div style={card}>
        <div style={eyebrow}>THE SEASON</div>
        <p style={body}>
          {plural(regularWeeks, "regular-season week")}, then the playoffs. Ties
          are broken by total points scored across the year, so a heavy defeat
          costs you twice.
        </p>
        <Rule what="Regular season" worth={`${regularWeeks} weeks`} />
        <Rule
          what="Trade deadline"
          worth={deadline > 0 ? `end of week ${deadline}` : "no deadline"}
        />
        <Rule
          what="Waivers clear after"
          worth={plural(waiverDays, "day")}
        />
      </div>

      {/* ------------------------------------------------------ the waiver --- */}
      <div style={card}>
        <div style={eyebrow}>WAIVERS AND FREE AGENTS</div>
        <p style={body}>
          A dropped player sits on the wire for {plural(waiverDays, "day")} before
          anybody can take him. While he is there, claims are collected rather
          than raced for — put one in and the order decides it, so there is no
          advantage in being awake at three in the morning. Anybody not on the
          wire is a free agent and yours immediately.
        </p>
        <p style={{ ...body, margin: 0 }}>
          Claim order runs worst record first, and drops to the back of the
          queue once a claim of yours goes through.
        </p>
      </div>

      {/* ------------------------------------------------------- the draft --- */}
      <div style={card}>
        <div style={eyebrow}>THE DRAFT</div>
        <p style={body}>
          {plural(Number(settings.rounds ?? 0), "round")}, snaking — the manager
          who picks last in one round picks first in the next. The clock
          shortens as the night goes on: {describeClock(clock)}.
        </p>
        <p style={{ ...body, margin: 0 }}>
          Queue the players you want and they are drafted for you in that order
          if your clock runs out. With nothing queued you get the best player
          left for what your roster still needs. If you know you cannot be
          there, switch autodraft on and it picks the moment your turn comes
          round rather than making everybody wait.
        </p>
      </div>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 18, fontSize: 11.5 }}>
        <Link
          href="/the-league"
          style={{ color: "#b5abfc", textDecoration: "none", display: "inline-flex", alignItems: "center", minHeight: 34 }}
        >
          ← The league
        </Link>
        <Link
          href="/lineup"
          style={{ color: "#b5abfc", textDecoration: "none", display: "inline-flex", alignItems: "center", minHeight: 34 }}
        >
          Set your lineup →
        </Link>
      </div>
    </div>
  );
}
