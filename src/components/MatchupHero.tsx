"use client";

import Link from "next/link";
import WinProbability from "./WinProbability";
import type { Upcoming } from "@/lib/home-types";

/**
 * The game you are in, and a way into the eleven you are not.
 *
 * This paged across the next five weeks, which answered a question nobody
 * asked twice: a projection for week five, drawn before week one has been
 * played, is arithmetic rather than news, and stepping through five of them
 * is five taps to reach the same conclusion. What a manager does want from
 * this card on a Sunday is the rest of the league — who else is playing, and
 * who is about to lose.
 *
 * So the pager goes and the card becomes a door. It shows the week in play:
 * who, where, what both sides project, what the season so far says about the
 * two of them, and the odds. Pressing it opens every fixture in that week.
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
  if (!upcoming.length) return null;

  // The week in play, or the next one. The rest of what the feed sends is the
  // schedule, and the schedule has a page.
  const g = upcoming[0];

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

      {/* Two doors, because they answer different questions and one of them
          used to be five taps of a pager. The first is this game in full; the
          second is everybody else's, which on a Sunday is the one worth
          having. */}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginTop: 10 }}>
        <Link href={`/lineup?week=${g.week}`} style={doorway}>
          THE FULL HEAD TO HEAD ›
        </Link>
        <Link href={`/matchups?view=league&week=${g.week}`} style={doorway}>
          EVERY GAME IN WEEK {g.week} ›
        </Link>
      </div>
    </div>
  );
}

const doorway: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  minHeight: 36,
  fontSize: 11.5,
  letterSpacing: ".1em",
  color: "var(--accent-link)",
  textDecoration: "none",
};

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
