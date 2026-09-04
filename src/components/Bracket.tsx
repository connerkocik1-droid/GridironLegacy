"use client";

import { useCallback, useEffect, useState } from "react";
import TeamCrest from "@/components/TeamCrest";
import { useLogos } from "@/lib/use-logos";

interface Side {
  id: string;
  franchise: string;
  who: string | null;
  seed: number | null;
  mine: boolean;
  points: number;
}

interface Game {
  id: string;
  week: number;
  final: boolean;
  winner: string | null;
  /** Decided on seed rather than on points, because the game was drawn. */
  onSeed: boolean;
  home: Side;
  away: Side;
}

interface Champion {
  season: number;
  manager_id: string | null;
  franchise: string;
  decided_at: string;
}

interface Feed {
  seeded: boolean;
  season: number | null;
  me: { id: string };
  champions: Champion[];
  /** What the finished bracket will be, not what has been drawn so far. */
  totalRounds?: number;
  seeds?: { seed: number; franchise: string; mine: boolean; bye: boolean; id: string }[];
  rounds?: { round: number; games: Game[] }[];
}

/** What a round is called, counting back from the last one. */
function roundName(round: number, total: number) {
  const from = total - round;
  if (from === 0) return "Final";
  if (from === 1) return "Semi-finals";
  if (from === 2) return "Quarter-finals";
  return `Round ${round}`;
}

const card: React.CSSProperties = {
  border: "1px solid rgba(145,132,217,.22)",
  borderRadius: "var(--radius-lg)",
  background: "rgba(26,28,43,.55)",
  overflow: "hidden",
};

function Team({
  side,
  won,
  decided,
  logo,
}: {
  side: Side;
  won: boolean;
  decided: boolean;
  logo: string | null;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "8px 12px",
        // A settled loser recedes; nothing is dimmed while it is still being
        // played, because a team behind at half time has not lost.
        opacity: decided && !won ? 0.45 : 1,
      }}
    >
      <span
        style={{
          fontSize: 10,
          width: 16,
          flex: "0 0 auto",
          color: "#75798c",
          letterSpacing: ".06em",
        }}
      >
        {side.seed ?? "—"}
      </span>
      <TeamCrest franchise={side.franchise} logo={logo} size={22} shape="box" fallback="empty" />
      <span
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 13.5,
          minWidth: 0,
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: side.mine ? "#d2cefd" : "#e9e9ed",
        }}
      >
        {side.franchise}
      </span>
      <span
        style={{
          fontSize: 13,
          fontVariantNumeric: "tabular-nums",
          color: won && decided ? "#7fd1a8" : "#9397ab",
        }}
      >
        {side.points.toFixed(1)}
      </span>
    </div>
  );
}

/**
 * The postseason, if there is one.
 *
 * Nothing is drawn for most of the year: the bracket appears the night the
 * last regular-season week is graded, and until then a league looking at this
 * page should see the table, not an empty diagram promising something.
 *
 * Laid out as a column of rounds rather than the branching diagram a bracket
 * usually is. The branches only read on a wide screen, and this league is
 * checked on a phone during a Sunday.
 */
export default function Bracket() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const logos = useLogos();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/playoffs", { cache: "no-store" });
      if (!res.ok) return;
      setFeed(await res.json());
    } catch {
      // The bracket is not the page. A league that cannot reach it still has
      // its standings underneath, which is the thing they came for.
    }
  }, []);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  if (!feed) return null;

  const past = feed.champions.filter((c) => c.season !== feed.season);

  if (!feed.seeded) {
    if (past.length === 0) return null;
    return <Titles champions={past} />;
  }

  // From the field, so a quarter-final does not become a semi-final next week.
  const total = feed.totalRounds ?? feed.rounds?.length ?? 0;
  const byes = (feed.seeds ?? []).filter((s) => s.bye);
  const champion = feed.champions.find((c) => c.season === feed.season);

  return (
    <div style={{ marginBottom: 26 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          flexWrap: "wrap",
          marginBottom: 12,
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 22,
            letterSpacing: "-.02em",
            fontWeight: 500,
            margin: 0,
          }}
        >
          The postseason
        </h2>
        {champion ? (
          <span style={{ fontSize: 11, color: "#e0b573" }}>
            {champion.franchise} are champions.
          </span>
        ) : byes.length ? (
          <span style={{ fontSize: 11, color: "#75798c" }}>
            {byes.map((b) => b.franchise).join(" and ")}{" "}
            {byes.length === 1 ? "has" : "have"} a first-round bye.
          </span>
        ) : null}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(260px, 100%), 1fr))",
          gap: 12,
          alignItems: "start",
        }}
      >
        {(feed.rounds ?? []).map(({ round, games }) => (
          <div key={round} style={card}>
            <div
              style={{
                padding: "10px 12px",
                borderBottom: "1px solid rgba(145,132,217,.18)",
                display: "flex",
                alignItems: "baseline",
                gap: 8,
              }}
            >
              <h6 style={{ margin: 0, color: "#d2cefd" }}>{roundName(round, total)}</h6>
              <span style={{ fontSize: 10, letterSpacing: ".14em", color: "#75798c" }}>
                WEEK {games[0]?.week}
              </span>
            </div>
            {games.map((g) => (
              <div key={g.id} style={{ borderTop: "1px solid rgba(145,132,217,.1)" }}>
                <Team
                  side={g.home}
                  won={g.winner === g.home.id}
                  decided={g.final}
                  logo={logos[g.home.id] ?? null}
                />
                <Team
                  side={g.away}
                  won={g.winner === g.away.id}
                  decided={g.final}
                  logo={logos[g.away.id] ?? null}
                />
                {g.onSeed ? (
                  <div style={{ padding: "0 12px 8px", fontSize: 10, color: "#e0b573" }}>
                    Drawn — the better seed goes through.
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>

      {past.length ? <Titles champions={past} /> : null}
    </div>
  );
}

/** The record book: what a dynasty is played for. */
function Titles({ champions }: { champions: Champion[] }) {
  return (
    <div style={{ ...card, marginTop: 14 }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(145,132,217,.18)" }}>
        <h6 style={{ margin: 0, color: "#9397ab" }}>Champions</h6>
      </div>
      {champions.map((c) => (
        <div
          key={c.season}
          style={{
            display: "flex",
            alignItems: "baseline",
            gap: 12,
            padding: "8px 14px",
            borderTop: "1px solid rgba(145,132,217,.1)",
          }}
        >
          <span
            style={{
              fontSize: 11,
              letterSpacing: ".12em",
              color: "#75798c",
              width: 42,
              flex: "0 0 auto",
            }}
          >
            {c.season}
          </span>
          <span style={{ fontFamily: "var(--font-heading)", fontSize: 14, color: "#e0b573" }}>
            {c.franchise}
          </span>
        </div>
      ))}
    </div>
  );
}
