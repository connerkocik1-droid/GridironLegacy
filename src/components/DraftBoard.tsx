"use client";

import { useMemo } from "react";
import { player } from "@/lib/roster";
import TeamCrest from "./TeamCrest";
import { useLogos, type Logos } from "@/lib/use-logos";

/**
 * The board: franchises across, rounds down, every pick in its cell.
 *
 * Columns are the round-one order, so a column is one franchise all the way
 * down. The snake shows itself in the pick numbers, which run left to right on
 * odd rounds and right to left on even ones — the same seat keeps the same
 * column either way, which is what makes a board readable at a glance.
 *
 * On a phone it is not a board at all. Twelve columns across a 390px screen is
 * two and a half franchises and a horizontal drag for the rest, which answers
 * "who has gone" about as badly as it can be answered — so the same picks are
 * drawn as a list, newest first, which is the order the question is asked in.
 * Both are rendered and CSS picks; the alternative is a media query in React,
 * which means the server draws one of them and the browser sometimes redraws
 * the other on the most time-critical screen in the app.
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
  const logos = useLogos();
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
              style={{ fontSize: 10, letterSpacing: ".1em", color: tint.fg }}
            >
              {pos === "D/ST" ? "DST" : pos}
            </span>
          ))}
        </div>
      </div>

      {/* The board scrolls inside itself; the page never scrolls sideways. */}
      <div className="gl-board-grid" style={{ overflowX: "auto" }}>
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
                  fontSize: 10,
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
                    fontSize: 10,
                    letterSpacing: ".12em",
                    color: m.id === meId ? "#d2cefd" : "#9397ab",
                    fontWeight: 400,
                    whiteSpace: "nowrap",
                    textAlign: "left",
                  }}
                >
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <TeamCrest
                      franchise={m.franchise}
                      logo={logos[m.id] ?? null}
                      size={18}
                      shape="box"
                      fallback="empty"
                    />
                    {m.slot}
                  </span>
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
                              fontSize: 10,
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
                            // Ten, not the nine this used to be to make "ON
                            // THE CLOCK" fit: below ten it stops being
                            // readable on a phone, so the label gave instead.
                            fontSize: 10,
                            letterSpacing: onClock ? ".1em" : 0,
                            fontVariantNumeric: "tabular-nums",
                            padding: "3px 0",
                          }}
                        >
                          {onClock
                            ? "ON CLOCK"
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

      <BoardList
        picks={picks}
        managers={managers}
        meId={meId}
        currentPick={currentPick}
        logos={logos}
      />
    </div>
  );
}

/**
 * The same picks on a phone: most recent first, and whoever is on the clock at
 * the top of it.
 *
 * Newest first because during a draft the question is "what just went", and
 * afterwards the board tab is not where anybody reads a whole draft anyway —
 * that is what a franchise's roster is for.
 */
function BoardList({
  picks,
  managers,
  meId,
  currentPick,
  logos,
}: {
  picks: Pick[];
  managers: Manager[];
  meId: string;
  currentPick: number;
  logos: Logos;
}) {
  const byId = useMemo(
    () => new Map(managers.map((m) => [m.id, m])),
    [managers],
  );

  const made = useMemo(
    () => picks.filter((p) => p.player_name).sort((a, b) => b.overall - a.overall),
    [picks],
  );

  const onClock = picks.find((p) => p.overall === currentPick && !p.player_name);

  return (
    <div className="gl-board-list">
      {onClock ? (
        <Row
          pick={onClock}
          manager={onClock.manager_id ? byId.get(onClock.manager_id) : undefined}
          logos={logos}
          meId={meId}
          onClock
        />
      ) : null}

      {made.length === 0 && !onClock ? (
        <div style={{ padding: "14px 18px", fontSize: 12, color: "#75798c" }}>
          Nobody has picked yet.
        </div>
      ) : null}

      {made.map((p) => (
        <Row
          key={p.overall}
          pick={p}
          manager={p.manager_id ? byId.get(p.manager_id) : undefined}
          logos={logos}
          meId={meId}
        />
      ))}
    </div>
  );
}

function Row({
  pick,
  manager,
  logos,
  meId,
  onClock,
}: {
  pick: Pick;
  manager: Manager | undefined;
  logos: Logos;
  meId: string;
  onClock?: boolean;
}) {
  const pl = pick.player_name ? player(pick.player_name) : null;
  const tint = pl ? POSITION_TINT[pl.p] : null;
  const mine = manager?.id === meId;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "9px 16px",
        borderTop: "1px solid rgba(145,132,217,.1)",
        background: onClock
          ? "rgba(145,132,217,.22)"
          : mine
            ? "rgba(145,132,217,.08)"
            : undefined,
      }}
    >
      <span
        style={{
          flex: "0 0 auto",
          width: 34,
          fontSize: 11,
          color: "#75798c",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {pick.round}.{String(pick.overall).padStart(2, "0")}
      </span>

      {/* The tint is the only thing carrying position on this row, so it is a
          chip rather than a wash across the whole line — at a phone's width a
          background tint behind a name is a colour nobody can name. */}
      <span
        style={{
          flex: "0 0 auto",
          minWidth: 32,
          textAlign: "center",
          fontSize: 10,
          letterSpacing: ".08em",
          padding: "2px 5px",
          borderRadius: 2,
          background: tint?.bg ?? "rgba(145,132,217,.1)",
          color: tint?.fg ?? "#75798c",
        }}
      >
        {pl ? (pl.p === "D/ST" ? "DST" : pl.p) : "—"}
      </span>

      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: 13,
            color: onClock ? "#d2cefd" : "#e9e9ed",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {pick.player_name ?? "On the clock"}
        </div>
        <div
          style={{
            fontSize: 10,
            color: "#75798c",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {manager?.franchise ?? "—"}
          {mine ? <span style={{ color: "#b5abfc" }}> · you</span> : null}
        </div>
      </div>

      {manager ? (
        <TeamCrest
          franchise={manager.franchise}
          logo={logos[manager.id] ?? null}
          size={24}
          shape="box"
          fallback="empty"
        />
      ) : null}
    </div>
  );
}
