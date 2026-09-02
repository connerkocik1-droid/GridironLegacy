"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

/**
 * Everything that belongs to the twelve of them rather than to any one.
 *
 * The other half of the split that put a manager's own things behind My Team.
 * The home page is now the score and three doors, which is a home page rather
 * than a table of contents.
 *
 * Places, not panels. Each one leads somewhere that does the work.
 */

interface Place {
  href: string;
  name: string;
  line: string;
  badge?: (counts: Counts) => string | null;
}

interface Counts {
  season: number | null;
  week: number | null;
  played: boolean;
}

const PLACES: Place[] = [
  {
    href: "/standings",
    name: "Standings",
    line: "The table, by division, once weeks start being graded.",
    badge: (c) => (c.played ? null : "Nothing graded yet."),
  },
  {
    href: "/league",
    name: "League overview",
    line: "Who is scoring at each position, the power rankings, and every franchise's roster.",
  },
  {
    href: "/activity",
    name: "Recent moves",
    line: "Every trade, claim and drop the league has made, newest first.",
  },
  {
    href: "/news",
    name: "League news",
    line: "The whole wire, everything the league might care about.",
  },
  {
    href: "/rankings",
    name: "Player rankings",
    line: "Every player in the pool, by position, with the numbers behind them.",
  },
  {
    href: "/free-agents",
    name: "Free agents",
    line: "Who is unowned, who is on waivers, and when they clear.",
  },
];

export default function LeagueHub() {
  const [counts, setCounts] = useState<Counts>({ season: null, week: null, played: false });
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    // Only for the heading and one badge. A failure costs both and nothing
    // else, so it is not allowed to break a page whose job is to be links.
    void fetch("/api/home", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((home) => {
        if (!home) return;
        setName(home.league?.name ?? null);
        setCounts({
          season: home.league?.season ?? null,
          week: home.week ?? null,
          played: Boolean(home.played),
        });
      })
      .catch(() => {});
  }, []);

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 18px 44px" }}>
      <div style={{ margin: "26px 0 20px" }}>
        <div style={{ fontSize: 10, letterSpacing: ".28em", color: "#75798c" }}>
          {counts.season ? `${counts.season} SEASON` : "THE LEAGUE"}
          {counts.week != null ? ` · WEEK ${counts.week}` : ""}
        </div>
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 30,
            letterSpacing: "-.025em",
            margin: "7px 0 0",
            fontWeight: 500,
            color: "#e9e9ed",
            overflowWrap: "anywhere",
          }}
        >
          {name ?? "The League"}
        </h1>
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
                <div style={{ fontSize: 11.5, color: "#75798c", marginTop: 8 }}>{badge}</div>
              ) : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
