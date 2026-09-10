"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Skeleton from "./Skeleton";
import PlayersBoard from "./PlayersBoard";
import TradeDesk from "./TradeDesk";
import ActivityFeed from "./ActivityFeed";
import { countdown } from "@/lib/moves-story";

/**
 * Everywhere a roster changes, on one screen.
 *
 * The third of the three hubs to be folded up, and the same argument each
 * time: free agents, the trade desk and the record were three pages behind
 * three buttons, and a manager deciding whether to make a move wants all three
 * at once — who is available, what a trade would cost, and what the league has
 * already done about him.
 *
 * The section lives in the address, so the back button steps through them and
 * the pages themselves keep working for everything that links to them.
 */

const TABS = ["Free Agents", "Trade Builder", "The Record"] as const;
type Tab = (typeof TABS)[number];

const slugOf = (t: Tab) => t.toLowerCase().replace(/\s+/g, "-");
const tabFrom = (slug: string | null): Tab =>
  TABS.find((t) => slugOf(t) === slug) ?? "Free Agents";

export default function MovesTabs() {
  return (
    <Suspense fallback={<Skeleton rows={6} />}>
      <Board />
    </Suspense>
  );
}

function Board() {
  const router = useRouter();
  const params = useSearchParams();
  const tab = tabFrom(params.get("tab"));

  const [navHeight, setNavHeight] = useState(0);
  const [clock, setClock] = useState<string | null>(null);

  // A real countdown to the next waiver run rather than a label saying one is
  // coming. It ticks, because a clock that does not is a picture of a clock.
  useEffect(() => {
    const tick = () => setClock(countdown(new Date()));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const nav = document.querySelector(".gl-nav");
    if (!nav) return;
    const measure = () => setNavHeight(nav.getBoundingClientRect().height);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  const go = useCallback(
    (next: Tab) => {
      const query = next === "Free Agents" ? "" : `?tab=${slugOf(next)}`;
      router.push(`/moves${query}`, { scroll: false });
    },
    [router],
  );

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
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <h1
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 24,
              letterSpacing: "-.025em",
              margin: 0,
              fontWeight: 500,
              color: "var(--text)",
              flex: 1,
              minWidth: 0,
            }}
          >
            Moves
          </h1>

          <div
            style={{ textAlign: "right", flex: "0 0 auto" }}
            aria-label="Time until the next waiver run"
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 5,
                justifyContent: "flex-end",
                fontSize: 10,
                letterSpacing: ".12em",
                color: "var(--warn)",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  background: "var(--warn)",
                  flex: "0 0 auto",
                }}
              />
              WAIVERS {clock ?? "—"}
            </div>
          </div>
        </div>

        <div
          role="tablist"
          aria-label="Moves sections"
          style={{ display: "flex", gap: 4, marginTop: 14 }}
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
                  // Three of them, so they share the width rather than
                  // scrolling: the strip fits at 320px.
                  flex: 1,
                  fontFamily: "inherit",
                  fontSize: 12,
                  letterSpacing: ".02em",
                  minHeight: 36,
                  padding: "8px 4px",
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
        {tab === "Free Agents" ? <PlayersBoard embedded /> : null}
        {tab === "Trade Builder" ? (
          <div style={{ padding: "0 18px" }}>
            <TradeDesk />
          </div>
        ) : null}
        {tab === "The Record" ? (
          <div style={{ padding: "0 18px" }}>
            <ActivityFeed />
          </div>
        ) : null}
      </div>
    </div>
  );
}
