"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useChatUnread } from "@/lib/use-chat-unread";

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
  /** Whoever is top of the league, and whether that is you. */
  leader: { franchise: string; mine: boolean } | null;
  /** Trades, claims and drops in the last day. */
  movesToday: number;
}

const PLACES: Place[] = [
  // First, and deliberately. Everything else on this page assumes you already
  // know how the league works; this is the one that says so, and the manager
  // who needs it most is the one who has never opened the app before.
  {
    href: "/rules",
    name: "How this league works",
    line: "Why nobody sets a lineup, how points are scored, waivers, trades and the draft.",
  },
  // Second, under the rules. The conversation is the thing a league actually
  // turns up for in year four, and burying it under five read-only pages is
  // how it ends up happening in a group text instead.
  {
    href: "/chat",
    name: "League chat",
    line: "Trash talk, trade bait and complaints about the schedule.",
  },
  {
    href: "/standings",
    name: "Standings",
    line: "The table, by division, once weeks start being graded.",
    badge: (c) =>
      !c.played
        ? "Nothing graded yet."
        : c.leader
          ? c.leader.mine
            ? "You are top of the league."
            : `${c.leader.franchise} are top of the league.`
          : null,
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
    // What happened while you were not looking, which is the only reason
    // anybody opens this page rather than waiting to be told.
    badge: (c) =>
      c.movesToday === 0
        ? null
        : c.movesToday === 1
          ? "1 move in the last day."
          : `${c.movesToday} moves in the last day.`,
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
  // The tab bar can only say "something"; here there is room for how much.
  const unread = useChatUnread();
  const [counts, setCounts] = useState<Counts>({
    season: null,
    week: null,
    played: false,
    leader: null,
    movesToday: 0,
  });
  const [name, setName] = useState<string | null>(null);

  useEffect(() => {
    // Only for the heading and three badges. A failure costs them and nothing
    // else, so neither of these is allowed to break a page whose job is to be
    // links — which is why both swallow everything and the state is written
    // once, from whatever came back.
    const DAY = 24 * 60 * 60 * 1000;

    void Promise.all([
      fetch("/api/home", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
      fetch("/api/activity", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null),
    ]).then(([home, activity]) => {
      if (home) setName(home.league?.name ?? null);

      const top = home?.played ? home.power?.[0] : null;
      const since = Date.now() - DAY;

      setCounts({
        season: home?.league?.season ?? null,
        week: home?.week ?? null,
        played: Boolean(home?.played),
        leader: top ? { franchise: top.franchise, mine: Boolean(top.mine) } : null,
        movesToday: (activity?.entries ?? []).filter(
          (e: { at?: string }) => e.at && Date.parse(e.at) >= since,
        ).length,
      });
    });
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
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  fontFamily: "var(--font-heading)",
                  fontSize: 21,
                  letterSpacing: "-.02em",
                  color: "#e9e9ed",
                }}
              >
                <span style={{ minWidth: 0 }}>{p.name}</span>
                {p.href === "/chat" && unread > 0 ? (
                  <span
                    style={{
                      flex: "0 0 auto",
                      fontFamily: "var(--font-body)",
                      fontSize: 10,
                      letterSpacing: ".12em",
                      padding: "3px 7px",
                      borderRadius: 999,
                      background: "rgba(145,132,217,.3)",
                      border: "1px solid rgba(181,171,252,.55)",
                      color: "#d2cefd",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {unread > 99 ? "99+" : unread} NEW
                  </span>
                ) : null}
              </div>
              <div style={{ fontSize: 11.5, color: "#9397ab", lineHeight: 1.55, marginTop: 6 }}>
                {p.line}
              </div>
              {/* The same amber as the My Team hub's. These two pages are
                  siblings and a manager moves between them; a live number that
                  is a different colour on each reads as two different kinds of
                  thing rather than the same one twice. */}
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
