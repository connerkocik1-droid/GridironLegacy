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
  lineupProblems: number;
  watching: number;
}

const PLACES: Place[] = [
  {
    href: "/lineup",
    name: "Lineup",
    line: "Set your starters, and see what they are playing against this week.",
    // Counted, not named. The number is enough to make somebody click, and
    // the lineup page is where the problems are actually said.
    badge: (c) =>
      c.lineupProblems === 0
        ? null
        : c.lineupProblems === 1
          ? "1 problem with this week's lineup."
          : `${c.lineupProblems} problems with this week's lineup.`,
  },
  {
    href: "/matchups",
    name: "Matchups",
    line: "Your season, week by week, with the score of every one. Or the whole league's.",
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
  },
  {
    href: "/my-team/edit",
    name: "Edit team",
    line: "Your team's name, its photo, and the PIN you sign in with.",
  },
];

export default function MyTeamHub() {
  const me = useMe();
  const [counts, setCounts] = useState<Counts>({ lineupProblems: 0, watching: 0 });

  useEffect(() => {
    // Both counts, only to put a number on a button. A failure here costs a
    // badge and nothing else, so neither request is allowed to break a page
    // whose job is to be six links.
    void Promise.all([
      fetch("/api/home", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/watchlist", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([home, watchlist]) =>
      setCounts({
        lineupProblems: Number(home?.lineupProblems ?? 0),
        watching: (watchlist?.players ?? []).length,
      }),
    );
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
