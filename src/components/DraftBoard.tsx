"use client";

import { useMemo } from "react";
import { player } from "@/lib/roster";

/**
 * The board: franchises across, rounds down, every pick in its cell.
 *
 * Columns are the round-one order, so a column is one franchise all the way
 * down. The snake shows itself in the pick numbers, which run left to right on
 * odd rounds and right to left on even ones — the same seat keeps the same
 * column either way, which is what makes a board readable at a glance.
 */

interface Pick {
  overall: number;
  round: number;
  manager_id: string | null;
  player_name: string | null;
  picked_at: string | null;
}

interface Manager {
  id: string;
  slot: string;
  franchise: string;
}

// Low-chroma tints rather than the loud primaries other sites use: the ground
// here is dark and desaturated, and twelve columns of bright colour is noise.
const POSITION_TINT: Record<string, { bg: string; fg: string }> = {
  QB: { bg: "rgba(224,131,131,.16)", fg: "#e5a3a3" },
  RB: { bg: "rgba(127,209,168,.15)", fg: "#8fd3b0" },
  WR: { bg: "rgba(145,164,217,.17)", fg: "#a8b8e8" },
  TE: { bg: "rgba(224,181,115,.15)", fg: "#e0bb84" },
  K: { bg: "rgba(160,150,190,.14)", fg: "#b0a8cc" },
  "D/ST": { bg: "rgba(140,140,155,.14)", fg: "#a8a8bb" },
};

export default function DraftBoard({
  picks,
  managers,
  meId,
  currentPick,
}: {
  picks: Pick[];
  managers: Manager[];
  meId: string;
  currentPick: number;
}) {
  const { columns, rounds, cell } = useMemo(() => {
    // Round one settles the column order; every later round reuses it, so a
    // franchise stays in one column however the snake turns.
    const firstRound = picks
      .filter((p) => p.round === 1)
      .sort((a, b) => a.overall - b.overall);

    const order = firstRound
      .map((p) => managers.find((m) => m.id === p.manager_id))
      .filter(Boolean) as Manager[];

    // A board built before the draft exists still needs columns.
    const columns = order.length ? order : managers;

    const byManagerRound = new Map<string, Pick>();
    for (const p of picks) {
      if (p.manager_id) byManagerRound.set(`${p.manager_id}:${p.round}`, p);
    }

    return {
      columns,
      rounds: picks.length ? Math.max(...picks.map((p) => p.round)) : 0,
      cell: (managerId: string, round: number) => byManagerRound.get(`${managerId}:${round}`),
    };
  }, [picks, managers]);

  if (!columns.length || !rounds) {
    return (
      <div style={{ padding: "18px 20px", fontSize: 13, color: "#75798c" }}>
        No board yet. The commissioner builds it from the league office.
      </div>
    );
  }

  const made = picks.filter((p) => p.player_name).length;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          padding: "13px 18px",
          borderBottom: "1px solid rgba(145,132,217,.18)",
          flexWrap: "wrap",
        }}
      >
        <h6 style={{ margin: 0, color: "#d2cefd" }}>The board</h6>
        <span style={{ fontSize: 10, letterSpacing: ".16em", color: "#75798c" }}>
          {made} OF {picks.length} PICKS MADE
        </span>
        <div style={{ display: "flex", gap: 10, marginLeft: "auto", flexWrap: "wrap" }}>
          {Object.entries(POSITION_TINT).map(([pos, tint]) => (
            <span
              key={pos}
              style={{ fontSize: 8.5, letterSpacing: ".1em", color: tint.fg }}
            >
              {pos === "D/ST" ? "DST" : pos}
            </span>
          ))}
        </div>
      </div>

      {/* The board scrolls inside itself; the page never scrolls sideways. */}
      <div style={{ overflowX: "auto" }}>
        <table
          style={{
            borderCollapse: "collapse",
            fontSize: 11,
            minWidth: columns.length * 116 + 46,
            width: "100%",
          }}
        >
          <thead>
            <tr>
              <th
                style={{
                  position: "sticky",
                  left: 0,
                  zIndex: 2,
                  width: 46,
                  padding: "8px 6px",
                  background: "#1b1d2c",
                  borderBottom: "1px solid rgba(145,132,217,.22)",
                  fontSize: 8,
                  letterSpacing: ".16em",
                  color: "#75798c",
                  fontWeight: 400,
                }}
              >
                RD
              </th>
              {columns.map((m) => (
                <th
                  key={m.id}
                  title={m.franchise}
                  style={{
                    padding: "8px 8px",
                    borderBottom: "1px solid rgba(145,132,217,.22)",
                    borderLeft: "1px solid rgba(145,132,217,.1)",
                    background: m.id === meId ? "rgba(66,58,106,.4)" : "transparent",
                    fontSize: 9,
                    letterSpacing: ".12em",
                    color: m.id === meId ? "#d2cefd" : "#9397ab",
                    fontWeight: 400,
                    whiteSpace: "nowrap",
                    textAlign: "left",
                  }}
                >
                  {m.slot}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {Array.from({ length: rounds }, (_, i) => i + 1).map((round) => (
              <tr key={round}>
                <td
                  style={{
                    position: "sticky",
                    left: 0,
                    zIndex: 1,
                    padding: "6px",
                    background: "#1b1d2c",
                    borderTop: "1px solid rgba(145,132,217,.1)",
                    fontSize: 10,
                    color: "#75798c",
                    textAlign: "center",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {round}
                </td>

                {columns.map((m) => {
                  const p = cell(m.id, round);
                  const onClock = p?.overall === currentPick && !p?.player_name;
                  const pl = p?.player_name ? player(p.player_name) : null;
                  const tint = pl ? POSITION_TINT[pl.p] : null;

                  return (
                    <td
                      key={m.id}
                      style={{
                        padding: "5px 7px",
                        borderTop: "1px solid rgba(145,132,217,.1)",
                        borderLeft: "1px solid rgba(145,132,217,.1)",
                        background: onClock
                          ? "rgba(145,132,217,.3)"
                          : (tint?.bg ?? "transparent"),
                        boxShadow: onClock ? "inset 0 0 0 1px rgba(181,171,252,.7)" : undefined,
                        verticalAlign: "top",
                        minWidth: 116,
                      }}
                    >
                      {p?.player_name ? (
                        <>
                          <div
                            style={{
                              display: "flex",
                              alignItems: "baseline",
                              gap: 5,
                              color: "#75798c",
                              fontSize: 8,
                              letterSpacing: ".08em",
                              fontVariantNumeric: "tabular-nums",
                            }}
                          >
                            <span>
                              {p.round}.{String(p.overall).padStart(2, "0")}
                            </span>
                            {pl ? (
                              <span style={{ color: tint?.fg }}>
                                {pl.p === "D/ST" ? "DST" : pl.p}
                              </span>
                            ) : null}
                          </div>
                          <div
                            style={{
                              color: "#e9e9ed",
                              fontSize: 11,
                              lineHeight: 1.25,
                              marginTop: 1,
                            }}
                          >
                            {p.player_name}
                          </div>
                        </>
                      ) : (
                        <div
                          style={{
                            color: onClock ? "#d2cefd" : "#464a5e",
                            fontSize: onClock ? 9 : 10,
                            letterSpacing: onClock ? ".12em" : 0,
                            fontVariantNumeric: "tabular-nums",
                            padding: "3px 0",
                          }}
                        >
                          {onClock
                            ? "ON THE CLOCK"
                            : p
                              ? `${p.round}.${String(p.overall).padStart(2, "0")}`
                              : ""}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
