"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRefreshable } from "@/lib/use-refresh";

/**
 * Everywhere a player changes hands.
 *
 * These three were split across two tabs for no reason anybody could defend:
 * the trade desk lived under My Team, the free agent list and the record of
 * what the league had done lived under The League. They are one family — the
 * only three screens in the app where a roster changes — and a manager wanting
 * to make a move had to know which of the two hubs each of them was filed
 * under. Nobody knows that. They are here.
 *
 * The tab this page sits behind is the draft room's, taken over once the draft
 * is complete. The two are never both what you need: the draft room is the
 * whole app in August and an empty board afterwards, and this page is the
 * reverse. See TabBar.
 *
 * Places, not panels: each card leads somewhere that does the work. The
 * badges are the reason to open one, so they are the part worth getting right
 * — a number about you beats a number about the league every time.
 */

interface Place {
  href: string;
  name: string;
  line: string;
  badge?: (counts: Counts) => string | null;
}

interface Counts {
  /** Offers waiting on an answer from this manager. */
  trades: number;
  /** Claims this manager has in, waiting for the wire to clear. */
  claims: number;
  /** Players sitting on waivers, whoever put them there. */
  onWaivers: number;
  /** Moves the whole league has made in the last day. */
  movesToday: number;
}

const PLACES: Place[] = [
  {
    href: "/free-agents",
    name: "Free agents",
    line: "Who is unowned, who is on waivers, and when they clear.",
    // Your own claims first: a claim you have in is a thing you are waiting
    // on, and the wire is only ever a thing to browse.
    badge: (c) =>
      c.claims > 0
        ? c.claims === 1
          ? "1 claim in, waiting to clear."
          : `${c.claims} claims in, waiting to clear.`
        : c.onWaivers > 0
          ? c.onWaivers === 1
            ? "1 player on waivers."
            : `${c.onWaivers} players on waivers.`
          : null,
  },
  {
    href: "/trade-builder",
    name: "Trade builder",
    line: "Put an offer together, and see what it does to both sides.",
    // The one badge in the app that is somebody waiting on you rather than a
    // number about you. It is the reason to open the card at all.
    badge: (c) =>
      c.trades === 0
        ? null
        : c.trades === 1
          ? "1 offer waiting on you."
          : `${c.trades} offers waiting on you.`,
  },
  {
    href: "/activity",
    name: "The record",
    line: "Every trade, claim and drop the league has made, newest first.",
    badge: (c) =>
      c.movesToday === 0
        ? null
        : c.movesToday === 1
          ? "1 move in the last day."
          : `${c.movesToday} moves in the last day.`,
  },
];

export default function MovesHub() {
  const [counts, setCounts] = useState<Counts>({
    trades: 0,
    claims: 0,
    onWaivers: 0,
    movesToday: 0,
  });

  // Pulled apart from the effect so the gesture can call it too. A hub whose
  // whole content is four numbers about what is waiting on you is exactly the
  // page somebody pulls down on, and until now the hubs answered nothing.
  const load = useCallback(async () => {
    // Only to put numbers on buttons. A failure costs a badge and nothing
    // else, so none of the three is allowed to break a page whose job is to
    // be three links — which is why each swallows everything and the state is
    // written once, from whatever came back.
    const DAY = 24 * 60 * 60 * 1000;
    const get = (url: string) =>
      fetch(url, { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);

    const [home, players, activity] = await Promise.all([
      get("/api/home"),
      get("/api/players"),
      get("/api/activity"),
    ]);

    const since = Date.now() - DAY;
    setCounts({
      trades: (home?.trades ?? []).length,
      claims: (players?.claims ?? []).length,
      onWaivers: (players?.wire ?? []).length,
      movesToday: (activity?.entries ?? []).filter(
        (e: { at?: string }) => e.at && Date.parse(e.at) >= since,
      ).length,
    });
  }, []);

  useRefreshable(load);

  useEffect(() => {
    // Sets state only once the requests resolve, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 18px 44px" }}>
      <div style={{ margin: "26px 0 20px" }}>
        <div style={{ fontSize: 10, letterSpacing: ".28em", color: "var(--text-dim)" }}>ROSTER MOVES</div>
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 30,
            letterSpacing: "-.025em",
            margin: "6px 0 0",
            fontWeight: 500,
            color: "var(--text)",
          }}
        >
          Moves
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
                border: "1px solid rgb(var(--accent-bright-rgb) / .4)",
                borderRadius: "var(--radius-md)",
                background: "rgb(var(--accent-rgb) / .12)",
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
                  color: "var(--text)",
                }}
              >
                {p.name}
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.55, marginTop: 6 }}>
                {p.line}
              </div>
              {badge ? (
                <div style={{ fontSize: 11.5, color: "var(--warn)", marginTop: 8 }}>{badge}</div>
              ) : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
