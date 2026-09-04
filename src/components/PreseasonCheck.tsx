"use client";

import { useCallback, useEffect, useState } from "react";
import type { PreseasonPlayer, PreseasonWeek } from "@/lib/preseason";

/**
 * Checking the scorer against a real game, before it counts for anything.
 *
 * The whole design of this page is one idea: never show a number without
 * showing where it came from. A page that says "Bijan Robinson 18.4" is
 * unfalsifiable — it looks equally right whether the parser read the box score
 * correctly or invented it. So every score here opens into the arithmetic that
 * produced it and the raw columns ESPN published, with a link straight to the
 * box score those columns came from.
 *
 * That makes the page usable by someone who does not read TypeScript, which
 * is the point: the commissioner can settle whether the scoring is right
 * without taking anyone's word for it.
 */

/**
 * The scoring format in the words a commissioner would use.
 *
 * This screen exists to settle whether the scoring is right before it counts
 * for anything, so echoing the settings key back — "ppr" — asks the reader to
 * know what the app calls things. "full PPR" is the thing being confirmed.
 */
const FORMAT_LABEL: Record<string, string> = {
  ppr: "full PPR — a point a catch",
  half: "half PPR — half a point a catch",
  standard: "standard — catches score nothing on their own",
};

const card: React.CSSProperties = {
  border: "1px solid rgba(145,132,217,.22)",
  borderRadius: "var(--radius-lg)",
  background: "rgba(26,28,43,.55)",
  overflow: "hidden",
};

const label: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: ".18em",
  color: "#75798c",
};

const chip = (on: boolean): React.CSSProperties => ({
  padding: "6px 12px",
  fontSize: 11,
  border: `1px solid ${on ? "rgba(181,171,252,.6)" : "rgba(145,132,217,.24)"}`,
  background: on ? "rgba(145,132,217,.26)" : "transparent",
  color: on ? "#e9e9ed" : "#9397ab",
  borderRadius: "var(--radius-sm)",
  font: "inherit",
  cursor: "pointer",
  minHeight: 34,
});

function num(n: number): string {
  return n.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

/**
 * One player's sum, written out.
 *
 * Deliberately arithmetic rather than prose: "90 rec yds ÷ 10 = 9" is a thing
 * a reader can check against ESPN in about a second, and "receiving yards
 * contributed 9 points" is not.
 */
function Working({ player }: { player: PreseasonPlayer }) {
  return (
    <div style={{ padding: "12px 16px", borderTop: "1px solid rgba(145,132,217,.14)" }}>
      <div style={{ ...label, marginBottom: 8 }}>HOW THAT WAS WORKED OUT</div>

      {player.terms.length ? (
        <div style={{ display: "grid", gap: 4, fontSize: 12.5 }}>
          {player.terms.map((t, i) => (
            <div
              key={i}
              style={{ display: "flex", gap: 10, alignItems: "baseline", flexWrap: "wrap" }}
            >
              <span style={{ color: "#c8ccdc", minWidth: 0 }}>{t.stat}</span>
              <span style={{ color: "#75798c", fontSize: 11.5 }}>{t.rule}</span>
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: "var(--font-heading)",
                  fontVariantNumeric: "tabular-nums",
                  color: t.points < 0 ? "#e0908f" : "#d2cefd",
                }}
              >
                {t.points > 0 ? "+" : ""}
                {num(t.points)}
              </span>
            </div>
          ))}
          <div
            style={{
              display: "flex",
              gap: 10,
              paddingTop: 6,
              marginTop: 2,
              borderTop: "1px solid rgba(145,132,217,.14)",
            }}
          >
            <span style={{ ...label }}>TOTAL</span>
            <span
              style={{
                marginLeft: "auto",
                fontFamily: "var(--font-heading)",
                fontVariantNumeric: "tabular-nums",
                color: "#e9e9ed",
              }}
            >
              {num(player.points)}
            </span>
          </div>
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: "#9397ab" }}>
          No rule applied to anything he did, so he scores nothing.
        </div>
      )}

      {player.raw.length ? (
        <>
          <div style={{ ...label, margin: "14px 0 8px" }}>WHAT ESPN PUBLISHED</div>
          <div className="gl-scroll-x" style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", fontSize: 11.5, minWidth: "100%" }}>
              <tbody>
                {player.raw.map((group, i) => (
                  <tr key={i}>
                    <td
                      style={{
                        padding: "4px 12px 4px 0",
                        color: "#75798c",
                        whiteSpace: "nowrap",
                        verticalAlign: "top",
                      }}
                    >
                      {group.group}
                    </td>
                    <td style={{ padding: "4px 0", color: "#c8ccdc" }}>
                      {Object.entries(group.stats)
                        .map(([k, v]) => `${k} ${v}`)
                        .join("  ·  ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}

      <a
        href={`https://www.espn.com/nfl/boxscore/_/gameId/${player.gameId}`}
        target="_blank"
        rel="noreferrer"
        style={{
          display: "inline-flex",
          alignItems: "center",
          minHeight: 34,
          marginTop: 10,
          fontSize: 11.5,
          color: "#b5abfc",
          textDecoration: "none",
        }}
      >
        Check it against ESPN&rsquo;s box score →
      </a>
    </div>
  );
}

function PlayerRow({ player, slot }: { player: PreseasonPlayer; slot?: string }) {
  return (
    <details style={{ borderTop: "1px solid rgba(145,132,217,.14)" }}>
      <summary
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "11px 16px",
          cursor: "pointer",
          minHeight: 34,
          listStyle: "none",
        }}
      >
        {slot ? (
          <span style={{ ...label, width: 44, flex: "0 0 auto" }}>{slot}</span>
        ) : null}

        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 14.5,
              color: "#e9e9ed",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {player.name}
          </div>
          <div style={{ fontSize: 11, color: "#75798c", marginTop: 2, lineHeight: 1.45 }}>
            {player.position || "—"} · {player.team}
            {/* Nothing here is ever a guess. ESPN's own answer is the silent
                default; the other two say where they came from, and "not
                stated" is an admitted blank rather than a position invented
                from the columns a man happened to appear in. */}
            {player.positionSource !== "espn" ? (
              <span style={{ color: player.positionSource === "pool" ? "#8a7fd4" : "#e0b573" }}>
                {" "}
                {player.positionSource === "pool"
                  ? "(position from our pool)"
                  : "(position not stated by ESPN)"}
              </span>
            ) : null}
            {player.workload ? ` · ${player.workload} touches` : ""}
          </div>

          {/* The same line the lineup and the matchup show, written by the
              same function, so checking it here is checking it there. */}
          {player.statLine ? (
            <div
              style={{
                fontSize: 11.5,
                color: "#c8ccdc",
                marginTop: 3,
                lineHeight: 1.45,
                overflowWrap: "anywhere",
              }}
            >
              {player.statLine}
            </div>
          ) : null}
        </div>

        <div
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 18,
            fontVariantNumeric: "tabular-nums",
            color: "#d2cefd",
            flex: "0 0 auto",
          }}
        >
          {num(player.points)}
        </div>
      </summary>
      <Working player={player} />
    </details>
  );
}

export default function PreseasonCheck() {
  const [week, setWeek] = useState<number | null>(null);
  const [data, setData] = useState<PreseasonWeek | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/preseason${week ? `?week=${week}` : ""}`, {
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) {
        setError(body.error ?? "Could not read the preseason.");
        setData(null);
      } else {
        setData(body);
      }
    } catch {
      setError("Could not read the preseason.");
      setData(null);
    }
    setLoading(false);
  }, [week]);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "0 18px 44px" }}>
      <div style={{ margin: "26px 0 18px" }}>
        <div style={label}>COMMISSIONER · SCORING CHECK</div>
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 26,
            margin: "8px 0 10px",
            color: "#e9e9ed",
            letterSpacing: "-.01em",
          }}
        >
          The preseason, scored
        </h1>
        <p style={{ fontSize: 13, color: "#9397ab", lineHeight: 1.6, margin: 0 }}>
          Real ESPN box scores put through the same arithmetic that will score the
          season, so it can be checked while being wrong still costs nothing. Tap
          any player to see the working and a link to the box score it came from.
        </p>
        <p style={{ fontSize: 12, color: "#75798c", lineHeight: 1.6, marginTop: 10 }}>
          Nothing here is written down. Preseason points never reach a roster, a
          record or a standings table — starters play a series and third-stringers
          play three quarters, so these numbers are a test of the parser and
          nothing else.
        </p>
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 14 }}>
        <button onClick={() => setWeek(null)} style={chip(week === null)}>
          Most recent
        </button>
        {[1, 2, 3, 4].map((w) => (
          <button key={w} onClick={() => setWeek(w)} style={chip(week === w)}>
            Week {w}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ fontSize: 12.5, color: "#75798c" }}>Reading ESPN…</div>
      ) : error ? (
        <div style={{ ...card, padding: "16px 18px", fontSize: 12.5, color: "#e0b573" }}>
          {error}
        </div>
      ) : !data || !data.found || !data.players.length ? (
        <div style={{ ...card, padding: "16px 18px", fontSize: 12.5, color: "#9397ab" }}>
          ESPN has no played games for that preseason week. Try another one — week 1
          is the Hall of Fame game and there is a gap before week 2.
        </div>
      ) : (
        <>
          <div style={{ fontSize: 11.5, color: "#75798c", marginBottom: 14, lineHeight: 1.7 }}>
            Preseason week {data.week} · {data.games.length}{" "}
            {data.games.length === 1 ? "game" : "games"} · scoring set to{" "}
            <span style={{ color: "#b5abfc" }}>
              {FORMAT_LABEL[data.format] ?? data.format}
            </span>
            {data.failed.length ? (
              <span style={{ color: "#e0b573" }}>
                {" "}
                · {data.failed.length} game(s) could not be read
              </span>
            ) : null}
          </div>

          <div style={{ ...card, marginBottom: 8 }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                padding: "12px 16px",
                flexWrap: "wrap",
              }}
            >
              <span style={label}>A MOCK LINEUP</span>
              <span style={{ fontSize: 11, color: "#75798c" }}>
                The busiest player at each slot
              </span>
              <span
                style={{
                  marginLeft: "auto",
                  fontFamily: "var(--font-heading)",
                  fontSize: 20,
                  color: "#e9e9ed",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {num(data.total)}
              </span>
            </div>

            {data.lineup.map((row, i) =>
              row.player ? (
                <PlayerRow key={`${row.slot}-${i}`} player={row.player} slot={row.slot} />
              ) : (
                <div
                  key={`${row.slot}-${i}`}
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: "11px 16px",
                    borderTop: "1px solid rgba(145,132,217,.14)",
                    fontSize: 12.5,
                    color: "#75798c",
                  }}
                >
                  <span style={{ ...label, width: 44, flex: "0 0 auto" }}>{row.slot}</span>
                  <span>Nobody in this week&rsquo;s games plays here.</span>
                </div>
              ),
            )}
          </div>

          <p style={{ fontSize: 11.5, color: "#75798c", lineHeight: 1.6, margin: "0 0 22px" }}>
            Picked by touches rather than by points on purpose: a third-string
            receiver who caught one long touchdown outscores everybody and proves
            nothing, while a back who carried it eighteen times has a stat line with
            enough in it to be worth checking.
          </p>

          <div style={{ ...card }}>
            <div style={{ padding: "12px 16px", display: "flex", gap: 10, flexWrap: "wrap" }}>
              <span style={label}>EVERYONE WHO TOUCHED THE BALL</span>
              <span style={{ fontSize: 11, color: "#75798c" }}>
                {data.players.length} players, busiest first
              </span>
            </div>
            {data.players.slice(0, 60).map((p) => (
              <PlayerRow key={`${p.gameId}-${p.name}`} player={p} />
            ))}
          </div>

          {data.unattributed.length ? (
            <div
              style={{
                ...card,
                marginTop: 14,
                padding: "14px 16px",
                fontSize: 12,
                color: "#e0b573",
                lineHeight: 1.6,
              }}
            >
              <div style={{ ...label, marginBottom: 6 }}>COULD NOT BE PINNED ON ANYONE</div>
              {data.unattributed.map((note, i) => (
                <div key={i}>{note}</div>
              ))}
              <div style={{ color: "#9397ab", marginTop: 8 }}>
                The scoreboard proved these happened; ESPN&rsquo;s wording did not say
                who by. They are reported rather than guessed at — a point given to
                the wrong player is worse than a point given late.
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
