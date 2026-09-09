"use client";

import Link from "next/link";
import { useState } from "react";
import WinProbability from "./WinProbability";
import type { Upcoming } from "@/lib/home-types";

/**
 * The next five weeks, one at a time.
 *
 * The home page used to show this week's fixture and nothing else, which is
 * the right answer on a Sunday and a dead card for the other five days. A
 * league is a season, and the question a manager actually has on a Tuesday is
 * not "what is the score" — it is "what is coming".
 *
 * So it pages. Each week stands on its own: who, where, what both sides
 * project, what the season so far says about the two of them, and the odds.
 * Every number is computed from the same league data the matchup page uses —
 * nothing here is written down.
 */

const stat = (value: string, label: string) => ({ value, label });

/** "+64.8" / "−31.2" / "0.0" — signed, with a real minus rather than a hyphen. */
function signed(n: number): string {
  if (Math.abs(n) < 0.05) return "0.0";
  return `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;
}

function recordOf(r: { w: number; l: number; t: number }): string {
  return `${r.w}-${r.l}${r.t ? `-${r.t}` : ""}`;
}

export default function MatchupHero({ upcoming, meFranchise }: { upcoming: Upcoming[]; meFranchise: string }) {
  const [at, setAt] = useState(0);
  if (!upcoming.length) return null;

  const i = Math.min(at, upcoming.length - 1);
  const g = upcoming[i];
  const step = (by: number) => setAt((n) => (n + by + upcoming.length) % upcoming.length);

  const stats = [
    stat(recordOf(g.opponent.record), "OPP RECORD"),
    stat(signed(g.pointsForGap), "PF GAP"),
    stat(signed(g.margin), g.live ? "MARGIN" : "PROJ MARGIN"),
  ];

  return (
    <div
      style={{
        border: "1px solid rgb(var(--accent-bright-rgb) / .3)",
        borderRadius: "var(--radius-lg)",
        background:
          "linear-gradient(160deg,rgb(var(--accent-rgb) / .22),rgb(var(--surface-rgb) / .7))",
        padding: "16px 18px 18px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span style={{ fontSize: 10, letterSpacing: ".28em", color: "var(--text-dim)" }}>
          WEEK {g.week}
        </span>
        <span style={{ fontSize: 10, letterSpacing: ".18em", color: "var(--accent-link)" }}>
          {g.live ? "LIVE" : g.atHome ? "AT HOME" : "ON THE ROAD"}
        </span>

        {/* Only where there is more than one week left to look at. */}
        {upcoming.length > 1 ? (
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 }}>
            <Pager label="Previous week" onClick={() => step(-1)}>‹</Pager>
            <span
              style={{
                fontSize: 10.5,
                color: "var(--text-dim)",
                fontVariantNumeric: "tabular-nums",
                minWidth: 26,
                textAlign: "center",
              }}
            >
              {i + 1}/{upcoming.length}
            </span>
            <Pager label="Next week" onClick={() => step(1)}>›</Pager>
          </div>
        ) : null}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) auto minmax(0,1fr)", gap: 10, alignItems: "start" }}>
        <SideName franchise={meFranchise} who="You" total={g.mine.total} align="left" />
        <span style={{ fontSize: 11, color: "var(--text-dim)", paddingTop: 6 }}>vs</span>
        <SideName
          franchise={g.opponent.franchise}
          who={g.opponent.name}
          total={g.theirs.total}
          align="right"
        />
      </div>

      <div style={{ marginTop: 14 }}>
        <WinProbability p={g.winProbability} />
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(3,minmax(0,1fr))",
          gap: 8,
          marginTop: 14,
          paddingTop: 13,
          borderTop: "1px solid rgb(var(--accent-rgb) / .2)",
        }}
      >
        {stats.map((s) => (
          <div key={s.label} style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 16,
                color: "var(--text)",
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {s.value}
            </div>
            <div
              style={{
                fontSize: 10,
                letterSpacing: ".12em",
                color: "var(--text-dim)",
                marginTop: 3,
                overflowWrap: "anywhere",
              }}
            >
              {s.label}
            </div>
          </div>
        ))}
      </div>

      <Link
        href={`/lineup?week=${g.week}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          minHeight: 36,
          marginTop: 10,
          fontSize: 11.5,
          letterSpacing: ".1em",
          color: "var(--accent-link)",
          textDecoration: "none",
        }}
      >
        THE FULL HEAD TO HEAD ›
      </Link>
    </div>
  );
}

function Pager({ children, label, onClick }: { children: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        width: 30,
        height: 30,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid rgb(var(--accent-rgb) / .3)",
        borderRadius: 7,
        background: "transparent",
        color: "var(--accent-link)",
        font: "inherit",
        fontSize: 15,
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function SideName({
  franchise,
  who,
  total,
  align,
}: {
  franchise: string;
  who: string;
  total: number;
  align: "left" | "right";
}) {
  return (
    <div style={{ minWidth: 0, textAlign: align }}>
      <div
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 17,
          letterSpacing: "-.02em",
          color: "var(--text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {franchise}
      </div>
      <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {who}
      </div>
      <div
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 30,
          letterSpacing: "-.03em",
          color: "var(--text)",
          fontVariantNumeric: "tabular-nums",
          marginTop: 6,
        }}
      >
        {total.toFixed(1)}
      </div>
    </div>
  );
}
