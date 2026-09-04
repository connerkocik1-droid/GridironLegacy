"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Skeleton from "./Skeleton";
import Bracket from "./Bracket";
import TeamCrest from "./TeamCrest";
import { useLogos } from "@/lib/use-logos";

/**
 * The table, by division.
 *
 * Divisions are how the season is actually decided here — the schedule plays
 * them twice — so the standings are grouped by them rather than being one
 * league-wide list with a division column nobody reads.
 */

interface Record_ {
  wins: number;
  losses: number;
  ties: number;
  divWins: number;
  divLosses: number;
  pointsFor: number;
  pointsAgainst: number;
}

interface Franchise {
  id: string;
  slot: string;
  name: string;
  franchise: string;
  division: string | null;
  claimed: boolean;
  pointsFor: number;
  record: Record_ | null;
  /** The last few settled weeks, oldest first. Absent before any are played. */
  form?: ("W" | "L" | "T")[];
}

interface Board {
  meId: string;
  league: { name: string; season: number } | null;
  played: boolean;
  franchises: Franchise[];
}

const th: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: ".16em",
  color: "#75798c",
  fontWeight: 400,
  textAlign: "right",
  padding: "0 0 8px",
  whiteSpace: "nowrap",
};

const td: React.CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontSize: 13,
  color: "#b2b6ca",
  textAlign: "right",
  padding: "9px 0",
  fontVariantNumeric: "tabular-nums",
};

function winPct(r: Record_): number {
  const games = r.wins + r.losses + r.ties;
  return games ? (r.wins + r.ties * 0.5) / games : 0;
}

export default function Standings() {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const logos = useLogos();

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/league", { cache: "no-store" });
      if (res.status === 401) return setError("Sign in to see the standings.");
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        return setError(body.error ?? "Could not read the league.");
      }
      setBoard(await res.json());
      setError(null);
    } catch {
      setError("Could not read the league.");
    }
  }, []);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = setInterval(() => void load(), 60_000);
    return () => clearInterval(timer);
  }, [load]);

  // Grouped by division, each ordered the way a table is: record first, then
  // points scored. A league with no divisions set is one group called the
  // league, rather than a heading that says null.
  const divisions = useMemo(() => {
    if (!board) return [];
    const groups = new Map<string, Franchise[]>();

    for (const f of board.franchises) {
      const key = f.division ?? "League";
      groups.set(key, [...(groups.get(key) ?? []), f]);
    }

    for (const list of groups.values()) {
      list.sort((a, b) => {
        const ar = a.record;
        const br = b.record;
        if (ar && br) {
          const diff = winPct(br) - winPct(ar);
          if (diff) return diff;
        }
        return b.pointsFor - a.pointsFor;
      });
    }

    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [board]);

  if (error && !board) {
    return <div style={{ padding: "24px 26px", color: "#e0b573" }}>{error}</div>;
  }
  if (!board) {
    return <Skeleton rows={6} />;
  }

  return (
    <div style={{ padding: "24px 26px 40px" }}>
      <div style={{ fontSize: 10, letterSpacing: ".32em", color: "#75798c" }}>THE TABLE</div>
      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 40,
          letterSpacing: "-.035em",
          margin: "8px 0 6px",
          fontWeight: 500,
        }}
      >
        Standings
      </h1>
      <p style={{ fontSize: 12.5, color: "#9397ab", margin: "0 0 18px" }}>
        {board.played
          ? "Ordered by record, then by points scored."
          : "Nothing has been graded yet, so this is ordered by points scored."}
      </p>

      {/* Above the table once there is one, because from the night the bracket
          is drawn it is the more urgent half of the same question. It draws
          nothing at all for the rest of the year. */}
      <Bracket />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit,minmax(min(340px,100%),1fr))",
          gap: 12,
          alignItems: "start",
        }}
      >
        {divisions.map(([name, teams]) => (
          <div
            key={name}
            style={{
              border: "1px solid rgba(145,132,217,.22)",
              borderRadius: "var(--radius-lg)",
              background: "rgba(26,28,43,.55)",
              overflowX: "auto",
            }}
          >
            <div
              style={{
                padding: "12px 15px 4px",
                fontSize: 10,
                letterSpacing: ".2em",
                color: "#b5abfc",
              }}
            >
              {name.toUpperCase()}
            </div>

            {/* Six columns of numbers do not narrow below a point where they
                stop meaning anything, so on a phone the table scrolls inside
                its own card rather than dragging the page sideways with it. */}
            <div className="gl-scroll-x">
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 320 }}>
              <thead>
                <tr>
                  <th style={{ ...th, textAlign: "left", padding: "8px 15px", width: "46%" }}>
                    FRANCHISE
                  </th>
                  <th style={th} title="Wins, losses and ties">W-L-T</th>
                  <th style={th} title="Record inside the division">DIV</th>
                  <th style={th} title="Points scored">PF</th>
                  <th style={{ ...th, paddingRight: 15 }} title="Points against">PA</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((f, i) => {
                  const r = f.record;
                  const mine = f.id === board.meId;
                  return (
                    <tr
                      key={f.id}
                      style={{
                        borderTop: "1px solid rgba(145,132,217,.1)",
                        background: mine ? "rgba(145,132,217,.1)" : undefined,
                      }}
                    >
                      <td style={{ padding: "8px 15px" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
                          <span
                            style={{
                              flex: "0 0 auto",
                              width: 14,
                              fontFamily: "var(--font-heading)",
                              fontSize: 11,
                              color: "#5a5d6e",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            {i + 1}
                          </span>
                          <TeamCrest
                            franchise={f.franchise}
                            logo={logos[f.id] ?? null}
                            size={24}
                            shape="box"
                            fallback="empty"
                          />
                          <div style={{ minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 13,
                                color: "#e9e9ed",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {f.franchise}
                              {mine ? (
                                <span style={{ color: "#b5abfc", fontSize: 10 }}> · YOU</span>
                              ) : null}
                            </div>
                            <div style={{ fontSize: 10, color: "#75798c", whiteSpace: "nowrap" }}>
                              {f.slot} · {f.claimed ? f.name : "open"}
                            </div>
                            <Form results={f.form ?? []} />
                          </div>
                        </div>
                      </td>
                      <td style={td}>
                        {r ? `${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ""}` : "—"}
                      </td>
                      <td style={td}>{r ? `${r.divWins}-${r.divLosses}` : "—"}</td>
                      <td style={td}>{f.pointsFor.toFixed(1)}</td>
                      <td style={{ ...td, paddingRight: 15 }}>
                        {r ? r.pointsAgainst.toFixed(1) : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * The last few weeks, won and lost.
 *
 * The line everybody reads first in any standings table anywhere, and this one
 * did not have it: "6-4" and "6-4 and falling apart" are the same cell. Five
 * results is about as many as anybody takes in at a glance, and it spans a bad
 * month without spanning a season.
 *
 * Under the name rather than in a column of its own. The table already scrolls
 * sideways on a phone with five columns of numbers; a sixth would cost width
 * this layout does not have, and vertical space is the cheap kind.
 */
function Form({ results }: { results: ("W" | "L" | "T")[] }) {
  if (!results.length) return null;

  const colour: Record<string, string> = {
    W: "#7fd1a8",
    L: "#e0908f",
    T: "#75798c",
  };

  return (
    <div
      // Read out as a sentence rather than as five letters, because "W L W W L"
      // out loud is not the shape a sighted reader is getting from this.
      title={`Last ${results.length}: ${results.join(" ")}`}
      aria-label={`Form, oldest first: ${results.join(", ")}`}
      style={{ display: "flex", gap: 3, marginTop: 4 }}
    >
      {results.map((r, i) => (
        <span
          key={i}
          aria-hidden
          style={{
            width: 13,
            height: 4,
            borderRadius: 2,
            flex: "0 0 auto",
            background: colour[r],
            // The most recent result is the one being asked about; the older
            // ones are context and fade back accordingly.
            opacity: 0.4 + (0.6 * (i + 1)) / results.length,
          }}
        />
      ))}
    </div>
  );
}
