"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import TeamCrest from "./TeamCrest";
import { useMe } from "@/lib/use-me";

/**
 * Everything that is about your franchise rather than about the league.
 *
 * The home page had grown into a list of everywhere you might go, which is a
 * table of contents rather than a home page. The split is by ownership: the
 * league's things — the table, the rankings, the wire — stay out there, and
 * the six that are yours alone live behind one button.
 *
 * Places, not panels. Each one leads somewhere that does the work; this page
 * only says where.
 */

interface Place {
  href: string;
  name: string;
  line: string;
  /** A count worth showing on the button itself, if there is one. */
  badge?: (counts: Counts) => string | null;
}

interface Counts {
  watching: number;
  /** Offers waiting on an answer from this manager. */
  trades: number;
  /** "12-0", once the league has graded something. */
  record: string | null;
  /** What this roster has scored this week, once the slate has started. */
  scored: number | null;
}

const PLACES: Place[] = [
  {
    href: "/lineup",
    name: "My roster",
    line: "Everyone you own, who is filling the slots this week, and what they are playing against.",
    badge: (c) => (c.scored == null ? null : `${c.scored.toFixed(1)} so far this week.`),
  },
  {
    href: "/matchups",
    name: "Matchups",
    line: "Your season, week by week, with the score of every one. Or the whole league's.",
    badge: (c) => (c.record ? `${c.record} this season.` : null),
  },
  {
    href: "/news?view=players",
    name: "Player news",
    line: "The wire, narrowed to your roster and the players you are watching.",
  },
  {
    href: "/watchlist",
    name: "Watchlist",
    line: "The players you are keeping an eye on, and what they have been doing.",
    badge: (c) =>
      c.watching === 0
        ? null
        : c.watching === 1
          ? "1 player watched."
          : `${c.watching} players watched.`,
  },
  {
    href: "/trade-builder",
    name: "Trade builder",
    line: "Put an offer together, and see what it does to both sides.",
    // The one badge on this page that is somebody waiting on you rather than
    // a number about you. It is the reason to open the card at all.
    badge: (c) =>
      c.trades === 0
        ? null
        : c.trades === 1
          ? "1 offer waiting on you."
          : `${c.trades} offers waiting on you.`,
  },
  {
    href: "/my-team/edit",
    name: "Edit team",
    line: "Your team's name, its photo, and the PIN you sign in with.",
  },
];

export default function MyTeamHub() {
  const me = useMe();
  const [counts, setCounts] = useState<Counts>({
    watching: 0,
    trades: 0,
    record: null,
    scored: null,
  });

  useEffect(() => {
    // Only to put numbers on buttons. A failure here costs a badge and nothing
    // else, so it is not allowed to break a page whose job is to be six links
    // — which is why both of these swallow everything and why the state is
    // written once, from whatever came back.
    void Promise.all([
      fetch("/api/watchlist", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/home", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([watchlist, home]) => {
      const mine = home?.games?.find((g: { mine?: boolean }) => g.mine);
      const side =
        mine && home ? [mine.home, mine.away].find((x: { id: string }) => x.id === home.meId) : null;
      const power = home?.played
        ? home.power?.find((r: { mine?: boolean }) => r.mine)
        : null;

      setCounts({
        watching: (watchlist?.players ?? []).length,
        trades: (home?.trades ?? []).length,
        record: power
          ? `${power.wins}-${power.losses}${power.ties ? `-${power.ties}` : ""}`
          : null,
        // A nought before kickoff is not a score, it is a week that has not
        // happened; the roster card says nothing rather than nothing-nil.
        scored: home?.started && side ? side.total : null,
      });
    });
  }, []);

  const manager = me.status === "signed-in" ? me.manager : null;

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 18px 44px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, margin: "26px 0 20px" }}>
        {manager ? (
          <TeamCrest franchise={manager.franchise} logo={manager.logo} size={52} shape="box" />
        ) : null}
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 10, letterSpacing: ".28em", color: "#75798c" }}>YOUR FRANCHISE</div>
          <h1
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 30,
              letterSpacing: "-.025em",
              margin: "6px 0 0",
              fontWeight: 500,
              color: "#e9e9ed",
              overflowWrap: "anywhere",
            }}
          >
            {manager?.franchise ?? "My team"}
          </h1>
        </div>
      </div>

      <div
        className="gl-cols"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(min(240px,100%),1fr))",
          gap: 10,
        }}
      >
        {PLACES.map((p) => {
          const badge = p.badge?.(counts) ?? null;
          return (
            <Link
              key={p.href}
              href={p.href}
              style={{
                display: "block",
                border: "1px solid rgba(181,171,252,.4)",
                borderRadius: "var(--radius-md)",
                background: "rgba(145,132,217,.12)",
                padding: "18px 18px 19px",
                textDecoration: "none",
                color: "inherit",
              }}
            >
              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 21,
                  letterSpacing: "-.02em",
                  color: "#e9e9ed",
                }}
              >
                {p.name}
              </div>
              <div style={{ fontSize: 11.5, color: "#9397ab", lineHeight: 1.55, marginTop: 6 }}>
                {p.line}
              </div>
              {badge ? (
                <div style={{ fontSize: 11.5, color: "#e0b573", marginTop: 8 }}>{badge}</div>
              ) : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
