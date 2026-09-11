"use client";
import { PlayerAge } from "./PlayerName";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { headshot } from "@/data/league-data";
import {
  bestValue,
  hotStreaks,
  recordOf,
  topScorers,
  type PlayerSeason,
  type Standing,
} from "@/lib/league-story";

/**
 * Three things worth knowing about the league, taken in turn.
 *
 * Not a dashboard of everything. A league page that shows twelve numbers shows
 * nothing, because there is no order to read them in — so this picks the three
 * that have actually moved and rotates them, and the rest of the screen is
 * behind sub-tabs for whoever wants it.
 *
 * All three are computed. Nothing here is written down about any particular
 * manager or player, which is what lets the card be right in week 14 as well
 * as week 3 — see src/lib/league-story.ts, where the sentences live and are
 * tested.
 *
 * A card with nothing to say does not appear. In September there is no
 * biggest riser and no streak, and three empty cards rotating through an
 * apology is worse than one card saying the season has not started.
 */

/** How long each card holds before the next. */
const ROTATE_MS = 6_500;

const MEDALS = [
  { ink: "#e8c56a", edge: "rgba(232,197,106,.55)" },
  { ink: "#c4cad6", edge: "rgba(196,202,214,.45)" },
  { ink: "#cd9060", edge: "rgba(205,144,96,.5)" },
];

const BLANK =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

const card: React.CSSProperties = {
  border: "1px solid rgb(var(--accent-bright-rgb) / .3)",
  borderRadius: "var(--radius-lg)",
  background:
    "linear-gradient(160deg,rgb(var(--accent-rgb) / .22),rgb(var(--surface-rgb) / .7))",
  padding: "16px 18px 18px",
  minHeight: 208,
};

const kicker: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: ".2em",
  color: "var(--accent-link)",
};

export default function LeagueStories({
  rows,
  players,
  graded,
  scored,
}: {
  rows: Standing[];
  players: PlayerSeason[];
  /** Weeks the league has settled into records. Streaks need these. */
  graded: number;
  /** Weeks anybody has been scored in. Players need these. */
  scored: number;
}) {
  const stories = useMemo(() => {
    const out: { key: string; label: string; node: React.ReactNode }[] = [];

    // Scoring and grading are not the same event, and this used to wait for
    // the wrong one. A week is graded when its last game ends; players are
    // scored from the first Thursday kickoff. Gating all three cards on
    // grading meant the screen sat on "nothing has been graded yet" for the
    // whole of every week, including the week everybody was watching.
    const value = scored ? bestValue(players, scored) : null;
    if (value && value.gain > 0) {
      out.push({
        key: "value",
        label: "BEST VALUE",
        node: <ValueCard value={value} weeks={scored} />,
      });
    }

    // The one card that does need a settled week: a streak is made of results.
    if (graded) {
      const { best, teams } = hotStreaks(rows);
      if (best > 1) {
        out.push({ key: "streak", label: "HOT STREAK", node: <StreakCard best={best} teams={teams} /> });
      }
    }

    const top = topScorers(players);
    if (top.length) out.push({ key: "mvp", label: "MVP", node: <MvpCard top={top} /> });

    return out;
  }, [rows, players, graded, scored]);

  const [at, setAt] = useState(0);

  useEffect(() => {
    if (stories.length < 2) return;
    const timer = setInterval(() => {
      // A card nobody is looking at does not need to keep turning.
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      setAt((n) => (n + 1) % stories.length);
    }, ROTATE_MS);
    return () => clearInterval(timer);
  }, [stories.length]);

  if (!stories.length) {
    return (
      <div style={{ ...card, minHeight: 0, display: "grid", gap: 6 }}>
        <div style={kicker}>THE SEASON</div>
        <p style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6, margin: 0 }}>
          Nobody has scored yet. From the first kickoff this fills with who has beaten their
          draft slot and who is scoring most, and it picks up the streaks once a week has
          been settled.
        </p>
      </div>
    );
  }

  const showing = stories[Math.min(at, stories.length - 1)];

  return (
    <div>
      <div style={card}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
          <span style={kicker}>{showing.label}</span>
        </div>
        {showing.node}
      </div>

      {stories.length > 1 ? (
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginTop: 10 }}>
          {stories.map((s, i) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setAt(i)}
              aria-label={`Show ${s.label.toLowerCase()}`}
              aria-current={i === at}
              style={{
                // The dot is 6px; the target around it is a thumb.
                width: 34,
                height: 34,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: 0,
                background: "transparent",
                cursor: "pointer",
                padding: 0,
              }}
            >
              <span
                style={{
                  width: i === at ? 18 : 6,
                  height: 6,
                  borderRadius: 99,
                  background:
                    i === at ? "var(--accent-link)" : "rgb(var(--accent-rgb) / .35)",
                  transition: "width .25s ease",
                }}
              />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Face({ name, size = 54 }: { name: string; size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={headshot(name) || BLANK}
      alt=""
      width={size}
      height={size}
      style={{
        borderRadius: "50%",
        objectFit: "contain",
        border: "1px solid rgb(var(--accent-rgb) / .3)",
        background: "rgb(var(--raised-rgb) / .7)",
        flex: "0 0 auto",
      }}
    />
  );
}

function ValueCard({
  value,
  weeks,
}: {
  value: NonNullable<ReturnType<typeof bestValue>>;
  weeks: number;
}) {
  const { player, now, gain } = value;
  const stats = [
    { value: player.points.toFixed(1), label: "POINTS" },
    { value: (player.points / Math.max(1, weeks)).toFixed(1), label: "PER GAME" },
    { value: `${player.pos}${now}`, label: "AT HIS SPOT" },
  ];

  return (
    <div>
      {/* Wraps, because the climb block on the right is 70-odd pixels and a
          320px screen then leaves the name sixty — which breaks a surname in
          half. */}
      <div style={{ display: "flex", alignItems: "center", gap: 13, flexWrap: "wrap", rowGap: 10 }}>
        <Face name={player.name} />
        <div style={{ minWidth: 0, flex: "1 1 140px" }}>
          <Link
            href={`/player/${encodeURIComponent(player.name)}`}
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 20,
              letterSpacing: "-.02em",
              color: "var(--text)",
              textDecoration: "none",
              overflowWrap: "anywhere",
              // The visual box is the text; the tap target is a thumb. The
              // negative margin gives back exactly what the padding took.
              display: "inline-flex",
              alignItems: "center",
              minHeight: 34,
              padding: "5px 0",
              margin: "-5px 0",
            }}
          >
            {player.name}
          </Link>
          <PlayerAge name={player.name} />
          <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 3 }}>
            {[player.pos, player.team].filter(Boolean).join(" · ")}
          </div>
        </div>
        <div style={{ textAlign: "right", flex: "0 0 auto" }}>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 17, color: "var(--good)" }}>
            ▲{gain}
          </div>
          <div style={{ fontSize: 10, letterSpacing: ".12em", color: "var(--text-dim)", marginTop: 2 }}>
            {player.pos}
            {player.preRank} → {player.pos}
            {now}
          </div>
        </div>
      </div>

      <Stats stats={stats} />
      <Read>{value.read}</Read>
    </div>
  );
}

function StreakCard({ best, teams }: { best: number; teams: Standing[] }) {
  return (
    <div>
      <div
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 18,
          letterSpacing: "-.02em",
          color: "var(--text)",
          lineHeight: 1.3,
        }}
      >
        {teams.length > 1
          ? `${teams.length} teams are riding ${best} straight.`
          : `${teams[0].owner} has won ${best} in a row.`}
      </div>

      <div style={{ display: "grid", gap: 7, marginTop: 12 }}>
        {teams.map((t) => (
          <div
            key={t.id}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "10px 11px",
              borderRadius: 11,
              border: `1px solid ${t.mine ? "rgb(var(--accent-bright-rgb) / .5)" : "rgb(var(--good-rgb) / .28)"}`,
              background: t.mine ? "rgb(var(--accent-rgb) / .16)" : "rgb(var(--surface-rgb) / .5)",
            }}
          >
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontFamily: "var(--font-heading)", fontSize: 14, color: "var(--text)" }}>
                {t.franchise}
              </div>
              <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 2 }}>
                {t.owner} · {recordOf(t)} · {t.pointsFor.toFixed(1)} PF
              </div>
            </div>
            <div style={{ display: "flex", gap: 3, flex: "0 0 auto" }}>
              {t.results.map((r, i) => (
                <span
                  key={i}
                  aria-hidden
                  style={{
                    width: 5,
                    height: 5,
                    borderRadius: "50%",
                    background: r === "W" ? "var(--good)" : "rgb(var(--accent-rgb) / .3)",
                  }}
                />
              ))}
            </div>
            <div style={{ fontFamily: "var(--font-heading)", fontSize: 17, color: "var(--good)" }}>
              W{t.streak}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function MvpCard({ top }: { top: PlayerSeason[] }) {
  return (
    <div>
      <div style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>
        {top.length === 1
          ? "The highest scorer in the league so far."
          : `The ${top.length === 2 ? "two" : "three"} highest scorers in the league so far.`}
      </div>

      <div style={{ display: "grid", gap: 7, marginTop: 12 }}>
        {top.map((p, i) => (
          <div
            key={p.name}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "9px 11px",
              borderRadius: 11,
              border: `1px solid ${MEDALS[i]?.edge ?? "rgb(var(--accent-rgb) / .25)"}`,
              background: "rgb(var(--surface-rgb) / .5)",
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 13,
                color: MEDALS[i]?.ink ?? "var(--text-dim)",
                width: 16,
                flex: "0 0 auto",
              }}
            >
              {i + 1}
            </span>
            <Face name={p.name} size={30} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <Link
                href={`/player/${encodeURIComponent(p.name)}`}
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 14,
                  color: "var(--text)",
                  textDecoration: "none",
                  overflowWrap: "anywhere",
                  display: "inline-flex",
                  alignItems: "center",
                  minHeight: 34,
                  padding: "6px 0",
                  margin: "-6px 0",
                }}
              >
                {p.name}
              </Link>
              <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 2 }}>
                {[p.pos, p.team].filter(Boolean).join(" · ")}
              </div>
            </div>
            <div
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 16,
                color: MEDALS[i]?.ink ?? "var(--text)",
                flex: "0 0 auto",
              }}
            >
              {p.points.toFixed(1)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stats({ stats }: { stats: { value: string; label: string }[] }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${stats.length},minmax(0,1fr))`,
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
  );
}

function Read({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 12, color: "var(--text-quiet)", lineHeight: 1.6, margin: "12px 0 0" }}>
      {children}
    </p>
  );
}
