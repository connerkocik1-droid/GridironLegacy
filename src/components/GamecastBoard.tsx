"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import LiveNumber from "./LiveNumber";
import PlayerName from "./PlayerName";
import Skeleton from "./Skeleton";
import TeamMark from "./TeamMark";
import { useMe } from "@/lib/use-me";
import { useRefreshable } from "@/lib/use-refresh";
import type { BoxTeam, Gamecast, GamecastPlay, OwnedPlayer } from "@/lib/gamecast";
import type { Competitor, Game, ScoringPlay, Situation } from "@/lib/espn";

/**
 * A real football game, read by somebody with a fantasy team.
 *
 * Every scoreboard in the world can tell you 21–17. What none of them tell
 * you is that four of the twenty-two people you care about are on that field,
 * which two are yours, which one belongs to the manager you are playing this
 * week, and what the touchdown thirty seconds ago did to your afternoon. That
 * is the whole reason to build this rather than link out to ESPN.
 *
 * So the order is: the score, then your players, then everybody else's, then
 * what actually happened. A manager who opens this during a game wants the
 * first two and will scroll for the rest.
 */

interface Board extends Gamecast {
  game: Game | null;
  teamTotals: Record<string, Record<string, string>>;
  error?: string;
  fetchedAt: string | null;
}

export default function GamecastBoard({ id }: { id: string }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("gamecast");
  const me = useMe();

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/game/${encodeURIComponent(id)}`, { cache: "no-store" });
      if (res.status === 401) return setError("Sign in to follow the game.");
      if (!res.ok) throw new Error(String(res.status));
      setBoard(await res.json());
      setError(null);
    } catch {
      setError("Could not reach the game.");
    }
  }, [id]);

  useRefreshable(load);

  useEffect(() => {
    // Sets state only once the request resolves, not synchronously.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Twenty seconds while the ball is in the air, and not at all once it is
  // over: a finished game does not change, and a phone left on this screen
  // should not spend the evening asking whether it has.
  const live = board?.game?.state === "in";
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      void load();
    }, 20_000);
    return () => clearInterval(timer);
  }, [live, load]);

  const mine = me.manager?.id ?? null;

  // Yours first, then everybody else's by score. Not sorted purely by points:
  // the question this screen answers is "how am I doing", and a manager
  // should never have to hunt down the list for their own name.
  const owned = useMemo(() => {
    if (!board) return [];
    const ours = board.owned.filter((p) => p.managerId === mine);
    const theirs = board.owned.filter((p) => p.managerId !== mine);
    return [...ours, ...theirs];
  }, [board, mine]);

  if (error && !board) {
    return <div style={{ padding: "24px 26px", color: "var(--warn)" }}>{error}</div>;
  }
  if (!board) return <Skeleton rows={5} />;

  const game = board.game;

  // `live` is already worked out above, for the polling.
  const situation = live ? (game?.situation ?? null) : null;

  return (
    <div style={{ padding: "12px 0 40px" }}>
      <div style={{ padding: "0 14px" }}>
        <Link
          href="/"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            height: 40,
            paddingRight: 8,
            color: "var(--accent-link)",
            font: "500 13px/1 inherit",
            textDecoration: "none",
          }}
        >
          <svg width="8" height="13" viewBox="0 0 8 13" fill="none" aria-hidden>
            <path d="M7 1L1.5 6.5L7 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Scores
        </Link>

        {game ? <GameHeader game={game} situation={situation} live={live} /> : null}
      </div>

      {board.error ? (
        <div style={{ padding: "0 14px", fontSize: 12.5, color: "var(--warn)", marginTop: 12 }}>
          {board.error}
        </div>
      ) : null}

      {situation && game ? (
        <Field
          situation={situation}
          attacking={situation.possession}
          defending={
            situation.possession === game.home?.abbrev
              ? (game.away?.abbrev ?? "")
              : (game.home?.abbrev ?? "")
          }
        />
      ) : null}

      <Tabs value={tab} onChange={setTab} counts={{ box: board.box.length, plays: board.plays.length }} />

      <div style={{ padding: "0 14px" }}>
        {tab === "gamecast" ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {board.plays[0] ? <LastPlay play={board.plays[0]} /> : null}

            {/* The reason this screen exists rather than a link to ESPN. Every
                scoreboard in the world has the score; none of them knows which
                of these twenty-two men is on somebody in this league's roster. */}
            {owned.length ? (
              <Section title="Who is in this game" note={`${owned.length} rostered`}>
                {owned.map((p) => (
                  <PlayerRow key={`${p.name}-${p.team}`} player={p} mine={p.managerId === mine} />
                ))}
              </Section>
            ) : game && game.state !== "pre" ? (
              <Section title="Who is in this game" note="nobody">
                <div style={{ padding: "13px 16px", fontSize: 12.5, color: "var(--text-muted)" }}>
                  Nobody in this league owns a player in this game.
                </div>
              </Section>
            ) : null}

            {board.notable.length ? (
              <Section title="Doing damage" note="unowned">
                {board.notable.map((p) => (
                  <PlayerRow key={`${p.name}-${p.team}`} player={p} mine={false} />
                ))}
              </Section>
            ) : null}

            {board.scoring.length ? <ScoringSummary scoring={board.scoring} /> : null}
          </div>
        ) : null}

        {tab === "box" ? (
          board.box.length ? (
            <BoxScore box={board.box} totals={board.teamTotals} game={game} />
          ) : (
            <Empty>No box score yet.</Empty>
          )
        ) : null}

        {tab === "plays" ? (
          board.plays.length ? <PlayList plays={board.plays} /> : <Empty>Nothing has happened yet.</Empty>
        ) : null}

        {tab === "stats" ? (
          game?.home && game.away ? (
            <TeamTotals
              totals={board.teamTotals}
              away={game.away.abbrev}
              home={game.home.abbrev}
            />
          ) : (
            <Empty>No team stats yet.</Empty>
          )
        ) : null}
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- pieces --- */

const SURFACE: React.CSSProperties = {
  background: "rgb(var(--surface-rgb) / .55)",
  border: "1px solid rgb(var(--accent-rgb) / .22)",
  borderRadius: "var(--radius-md)",
};

const EYEBROW: React.CSSProperties = {
  font: "600 10px/1 inherit",
  letterSpacing: ".1em",
  color: "var(--text-muted)",
};

/** A team's three letters, in a chip that carries its own colour. */
function TeamChip({ abbrev, accent, size = 38 }: { abbrev: string; accent: boolean; size?: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 8,
        flex: "0 0 auto",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        font: `700 ${size < 32 ? 9 : 12}px/1 inherit`,
        background: accent ? "rgb(var(--accent-rgb) / .14)" : "rgb(var(--sunken-rgb) / .8)",
        boxShadow: `inset 0 0 0 1px ${accent ? "rgb(var(--accent-bright-rgb) / .45)" : "rgb(var(--accent-rgb) / .22)"}`,
        color: accent ? "var(--accent-text)" : "var(--text-2)",
      }}
    >
      {abbrev}
    </div>
  );
}

/**
 * The ball, beside whoever has it.
 *
 * Only ever drawn while a game is being played, because possession is a fact
 * about right now — on a final score it would say somebody was mid-drive.
 */
function Possession() {
  return (
    <span
      aria-label="has the ball"
      style={{
        width: 13,
        height: 9,
        borderRadius: "9px/50%",
        background: "var(--accent-solid)",
        display: "inline-block",
        transform: "rotate(-20deg)",
        flex: "0 0 auto",
      }}
    />
  );
}

/**
 * One side of the header: chip, name, the ball if they have it, points by
 * period, and the score.
 *
 * The quarter columns are drawn only when the feed sent a full set. A partial
 * line score is worse than none here — the columns are fixed width, so a
 * missing quarter silently shifts every number after it into the wrong one.
 */
function TeamLine({
  side,
  periods,
  hasBall,
  leading,
  live,
}: {
  side: Competitor;
  periods: number[];
  hasBall: boolean;
  leading: boolean;
  live: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <TeamChip abbrev={side.abbrev} accent={hasBall} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span
            style={{
              font: "600 15.5px/1.15 var(--font-heading)",
              letterSpacing: "-.2px",
              color: "var(--text)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {side.name}
          </span>
          {hasBall && live ? <Possession /> : null}
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flex: "0 0 auto" }}>
        {periods.map((n, i) => (
          <span
            key={i}
            className="gl-gc-period"
            style={{
              width: 13,
              textAlign: "center",
              font: "400 11.5px/1 inherit",
              fontVariantNumeric: "tabular-nums",
              color: "var(--text-dim)",
            }}
          >
            {n}
          </span>
        ))}
        <span
          style={{
            width: 38,
            textAlign: "right",
            font: "600 30px/1 var(--font-heading)",
            fontVariantNumeric: "tabular-nums",
            letterSpacing: "-1px",
            color: leading ? "var(--text)" : "var(--text-quiet)",
          }}
        >
          {side.score}
        </span>
      </div>
    </div>
  );
}

/**
 * The pitch, with the ball on it.
 *
 * Drawn from ESPN's `situation`, which this app had never read before and
 * which cannot be checked against a live feed from where this was written — so
 * every part of it is optional and this returns null the moment there is not
 * enough to be truthful. A pitch with a guessed ball on it is worse than no
 * pitch: it is the one graphic on the page somebody reads without checking.
 *
 * ESPN gives `yardLine` already in the frame the possessing side is attacking:
 * 0 at their own goal line, 100 at the one they want. So the drawing needs no
 * arithmetic about which way anybody is going.
 */
function Field({
  situation,
  attacking,
  defending,
}: {
  situation: Situation;
  attacking: string;
  defending: string;
}) {
  const { yardLine, lineToGain } = situation;
  if (yardLine == null) return null;

  const pct = (n: number) => `${Math.max(0, Math.min(100, n))}%`;
  const sticks = lineToGain != null && lineToGain <= 100 ? lineToGain : null;

  return (
    <div style={{ padding: "0 14px 14px" }}>
      <div
        style={{
          display: "flex",
          height: 74,
          borderRadius: "var(--radius-md)",
          overflow: "hidden",
          boxShadow: "none",
        }}
      >
        <EndZone abbrev={attacking} />
        <div
          style={{
            flex: 1,
            position: "relative",
            background: "linear-gradient(180deg,rgb(var(--sunken-rgb) / .95),rgb(var(--sunken-rgb) / .8))",
          }}
        >
          {/* Every ten yards. */}
          <div
            style={{
              position: "absolute",
              inset: 0,
              background:
                "repeating-linear-gradient(90deg,transparent 0,transparent calc(10% - 1px),rgb(var(--accent-rgb) / .22) calc(10% - 1px),rgb(var(--accent-rgb) / .22) 10%)",
            }}
          />
          {/* The sticks, in the yellow they are on television. */}
          {sticks != null ? (
            <div
              style={{
                position: "absolute",
                top: 0,
                bottom: 0,
                left: pct(sticks),
                width: 2,
                background: "#d8c65e",
              }}
            />
          ) : null}
          {/* The line of scrimmage, and the ball on it. */}
          <div
            style={{
              position: "absolute",
              top: 0,
              bottom: 0,
              left: pct(yardLine),
              width: 2,
              background: "var(--accent-link)",
            }}
          />
          <div
            className="gl-gc-ball"
            style={{
              position: "absolute",
              top: "50%",
              left: pct(yardLine),
              width: 11,
              height: 11,
              margin: "-5.5px 0 0 -5.5px",
              borderRadius: "50%",
              background: "var(--accent-text)",
            }}
          />
          <div
            style={{
              position: "absolute",
              bottom: 5,
              left: 0,
              right: 0,
              display: "flex",
              justifyContent: "space-between",
              padding: "0 6%",
            }}
          >
            {[10, 20, 30, 40, 50, 40, 30, 20, 10].map((y, i) => (
              <span
                key={i}
                style={{
                  font: "500 9px/1 inherit",
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--text-dim)",
                }}
              >
                {y}
              </span>
            ))}
          </div>
        </div>
        <EndZone abbrev={defending} accent />
      </div>
    </div>
  );
}

function EndZone({ abbrev, accent = false }: { abbrev: string; accent?: boolean }) {
  return (
    <div
      style={{
        width: 26,
        flex: "none",
        background: accent ? "rgb(var(--accent-rgb) / .14)" : "rgb(var(--sunken-rgb) / .8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        [accent ? "borderLeft" : "borderRight"]:
          `1px solid ${accent ? "rgb(var(--accent-bright-rgb) / .45)" : "rgb(var(--accent-rgb) / .22)"}`,
      }}
    >
      <span
        style={{
          font: "700 9px/1 inherit",
          letterSpacing: ".1em",
          color: accent ? "var(--accent-link)" : "var(--text-dim)",
          transform: `rotate(${accent ? 90 : -90}deg)`,
        }}
      >
        {abbrev}
      </span>
    </div>
  );
}

function PlayerRow({ player, mine }: { player: OwnedPlayer; mine: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px",
        borderTop: "1px solid rgb(var(--accent-rgb) / .12)",
        background: mine ? "rgb(var(--accent-rgb) / .12)" : undefined,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <PlayerName name={player.name} style={{ fontFamily: "var(--font-heading)", fontSize: 14 }} />
          <TeamMark team={player.team} />
        </div>
        <div style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 3, lineHeight: 1.45 }}>
          {player.position ? `${player.position} · ` : ""}
          {player.franchise ?? "free agent"}
          {player.statLine ? ` · ${player.statLine}` : ""}
        </div>
      </div>

      <div
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 17,
          color: mine ? "var(--accent-text)" : "var(--text-3)",
          fontVariantNumeric: "tabular-nums",
          flex: "0 0 auto",
          whiteSpace: "nowrap",
        }}
      >
        <LiveNumber value={player.points} />
      </div>
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 22 }}>
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 10,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 15,
            fontWeight: 500,
            margin: 0,
            color: "var(--accent-text)",
          }}
        >
          {title}
        </h2>
        {note ? <span style={{ fontSize: 10.5, color: "var(--text-dim)" }}>{note}</span> : null}
      </div>

      <div
        style={{
          border: "1px solid rgb(var(--accent-rgb) / .22)",
          borderRadius: "var(--radius-lg)",
          background: "rgb(var(--surface-rgb) / .55)",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/**
 * The box score, which is the one part of this screen that is not about
 * fantasy at all.
 *
 * Everything above it reads the game through a roster. This reads the game.
 * It is ESPN's own groups, in ESPN's own order, with ESPN's own column
 * headings — the moment it starts choosing which columns matter it stops
 * being a box score and becomes another opinion, so it chooses nothing and
 * scrolls a table sideways instead of dropping a column somebody wanted.
 *
 * One team at a time, because two full box scores stacked on a phone is a
 * wall nobody reads, and the question is always about one side. The away team
 * is first, as it is on the scoreline above and on every scoreboard there has
 * ever been.
 */
function BoxScore({
  box,
  totals,
  game,
}: {
  box: BoxTeam[];
  totals: Record<string, Record<string, string>>;
  game: Game | null;
}) {
  // Away first, then home, then anything ESPN sent that is neither — which
  // should be nothing, and is not worth losing if it happens.
  const order = [game?.away?.abbrev, game?.home?.abbrev].filter(Boolean) as string[];
  const teams = [
    ...order.map((a) => box.find((t) => t.team === a)).filter(Boolean),
    ...box.filter((t) => !order.includes(t.team)),
  ] as BoxTeam[];

  const [showing, setShowing] = useState(teams[0]?.team ?? "");
  const team = teams.find((t) => t.team === showing) ?? teams[0];
  if (!team) return null;

  const away = order[0];
  const home = order[1];

  return (
    <Section title="Box score" note={team.team}>
      {away && home && (totals[away] || totals[home]) ? (
        <TeamTotals away={away} home={home} totals={totals} />
      ) : null}

      {teams.length > 1 ? (
        <div
          role="tablist"
          aria-label="Box score team"
          style={{
            display: "flex",
            borderTop: "1px solid rgb(var(--accent-rgb) / .12)",
          }}
        >
          {teams.map((t) => {
            const on = t.team === team.team;
            return (
              <button
                key={t.team}
                role="tab"
                aria-selected={on}
                onClick={() => setShowing(t.team)}
                style={{
                  flex: 1,
                  minWidth: 0,
                  minHeight: 40,
                  padding: "9px 8px",
                  border: "none",
                  borderBottom: `2px solid ${on ? "var(--accent-text)" : "transparent"}`,
                  background: on ? "rgb(var(--accent-rgb) / .12)" : "transparent",
                  color: on ? "var(--text)" : "var(--text-dim)",
                  font: "inherit",
                  fontFamily: "var(--font-heading)",
                  fontSize: 13,
                  letterSpacing: ".06em",
                  cursor: on ? "default" : "pointer",
                }}
              >
                {t.team}
              </button>
            );
          })}
        </div>
      ) : null}

      {team.groups.map((g) => (
        <div key={g.group} style={{ borderTop: "1px solid rgb(var(--accent-rgb) / .12)" }}>
          <div
            style={{
              fontSize: 10,
              letterSpacing: ".2em",
              color: "var(--text-dim)",
              padding: "10px 16px 7px",
            }}
          >
            {g.group.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase()}
          </div>

          {/* The table scrolls inside itself. A box score is wider than a
              phone and always will be; the page must not be. */}
          <div className="gl-scroll-x" style={{ overflowX: "auto", padding: "0 16px 12px" }}>
            <table
              style={{
                borderCollapse: "collapse",
                fontSize: 12,
                fontVariantNumeric: "tabular-nums",
                whiteSpace: "nowrap",
              }}
            >
              <thead>
                <tr>
                  <th style={{ ...cell, textAlign: "left", color: "var(--text-dim)", fontWeight: 400 }} />
                  {g.labels.map((label) => (
                    <th
                      key={label}
                      style={{
                        ...cell,
                        color: "var(--text-dim)",
                        fontWeight: 400,
                        fontSize: 10,
                        letterSpacing: ".08em",
                      }}
                    >
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r, i) => (
                  <tr key={`${r.name}-${i}`}>
                    <td style={{ ...cell, textAlign: "left", color: "var(--text-2)", paddingRight: 14 }}>
                      {r.name}
                    </td>
                    {r.values.map((v, j) => (
                      <td key={g.labels[j] ?? j} style={{ ...cell, color: "var(--text-3)" }}>
                        {v}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </Section>
  );
}

const cell: React.CSSProperties = {
  padding: "5px 7px",
  textAlign: "right",
  borderBottom: "1px solid rgb(var(--accent-rgb) / .08)",
};

/**
 * The team-total comparison, which is the half of a box score people actually
 * read: total yards, who ran it, who turned it over.
 *
 * ESPN keys these by its own camelCase names, which are what the scoring code
 * reads too, so they are not renamed at the source. The order and the wording
 * are chosen here. Anything ESPN sends that is not on the list still appears,
 * de-camelCased, at the bottom — a box score that silently drops a row is
 * worse than one that shows a row nobody named.
 */
const TOTAL_ROWS: [string, string][] = [
  ["totalYards", "Total yards"],
  ["netPassingYards", "Passing"],
  ["rushingYards", "Rushing"],
  ["firstDowns", "First downs"],
  ["thirdDownEff", "Third down"],
  ["fourthDownEff", "Fourth down"],
  ["totalPenaltiesYards", "Penalties"],
  ["sacksYardsLost", "Sacked"],
  ["turnovers", "Turnovers"],
  ["possessionTime", "Possession"],
];

function TeamTotals({
  away,
  home,
  totals,
}: {
  away: string;
  home: string;
  totals: Record<string, Record<string, string>>;
}) {
  const named = new Set(TOTAL_ROWS.map(([key]) => key));
  const extra = [
    ...new Set([...Object.keys(totals[away] ?? {}), ...Object.keys(totals[home] ?? {})]),
  ].filter((key) => !named.has(key));

  const rows: [string, string][] = [
    ...TOTAL_ROWS,
    ...extra.map((key): [string, string] => [
      key,
      key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()),
    ]),
  ].filter(([key]) => totals[away]?.[key] != null || totals[home]?.[key] != null);

  if (!rows.length) return null;

  /**
   * The share of a row that belongs to the away side, for the bar under it.
   *
   * Only where both numbers are plain counts. "5-13" and "28:12" are real
   * values a manager wants to read, and neither divides into a proportion —
   * so those rows keep their numbers and go without a bar rather than being
   * given a misleading one.
   */
  const share = (a?: string, h?: string): number | null => {
    const x = Number(a);
    const y = Number(h);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x + y <= 0) return null;
    return x / (x + y);
  };

  return (
    <div style={{ ...SURFACE, overflow: "hidden" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 13px",
          background: "rgb(var(--sunken-rgb) / .8)",
        }}
      >
        <span style={{ font: "700 10px/1 var(--font-heading)", color: "var(--accent-link)" }}>{away}</span>
        <span style={{ ...EYEBROW }}>TEAM STATS</span>
        <span style={{ font: "700 10px/1 var(--font-heading)", color: "var(--text-3)" }}>{home}</span>
      </div>

      {rows.map(([key, label], i) => {
        const a = totals[away]?.[key];
        const h = totals[home]?.[key];
        const pct = share(a, h);
        return (
          <div
            key={key}
            style={{
              padding: "11px 13px",
              borderTop: i === 0 ? undefined : "1px solid rgb(var(--accent-rgb) / .12)",
              display: "flex",
              flexDirection: "column",
              gap: 7,
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
              <span
                style={{
                  width: 62,
                  font: "600 13px/1 var(--font-heading)",
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--accent-text)",
                }}
              >
                {a ?? "—"}
              </span>
              <span
                style={{
                  flex: 1,
                  textAlign: "center",
                  font: "400 11px/1.2 inherit",
                  color: "var(--text-muted)",
                  minWidth: 0,
                  overflowWrap: "anywhere",
                }}
              >
                {label}
              </span>
              <span
                style={{
                  width: 62,
                  textAlign: "right",
                  font: "600 13px/1 var(--font-heading)",
                  fontVariantNumeric: "tabular-nums",
                  color: "var(--text-2)",
                }}
              >
                {h ?? "—"}
              </span>
            </div>
            {pct != null ? (
              <div
                style={{
                  display: "flex",
                  height: 5,
                  borderRadius: 3,
                  overflow: "hidden",
                  background: "rgb(var(--sunken-rgb) / .8)",
                }}
              >
                <div style={{ width: `${pct * 100}%`, background: "var(--accent-solid)" }} />
                <div style={{ flex: 1, background: "rgb(var(--accent-rgb) / .3)" }} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}


/* --------------------------------------------------------------- header --- */

/**
 * The two teams, their points by period, and where the game is.
 *
 * The quarter columns are drawn only when both sides sent the same number of
 * them. They are fixed-width, so a side missing a quarter would shift every
 * number after it into the wrong column — which is worse than not showing them
 * at all, because it is wrong rather than absent.
 */
function GameHeader({
  game,
  situation,
  live,
}: {
  game: Game;
  situation: Situation | null;
  live: boolean;
}) {
  const { home, away } = game;
  if (!home || !away) return null;

  const a = away.linescores ?? [];
  const h = home.linescores ?? [];
  const periods = a.length && a.length === h.length ? { away: a, home: h } : { away: [], home: [] };

  return (
    <>
      <div style={{ display: "flex", flexDirection: "column", gap: 10, padding: "4px 2px 12px" }}>
        <TeamLine
          side={away}
          periods={periods.away}
          hasBall={situation?.possession === away.abbrev}
          leading={away.score >= home.score}
          live={live}
        />
        <TeamLine
          side={home}
          periods={periods.home}
          hasBall={situation?.possession === home.abbrev}
          leading={home.score >= away.score}
          live={live}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
          padding: "0 2px 12px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7, minWidth: 0 }}>
          {live ? (
            <span
              className="gl-live-dot"
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: "var(--accent-solid)",
                flex: "0 0 auto",
              }}
            />
          ) : null}
          <span
            style={{
              font: "600 12px/1 inherit",
              fontVariantNumeric: "tabular-nums",
              color: live ? "var(--accent-link)" : "var(--text-3)",
            }}
          >
            {game.statusDetail}
          </span>
        </div>
        {situation?.downDistanceText ? (
          <div
            style={{
              font: "500 11.5px/1 inherit",
              color: "var(--text-3)",
              minWidth: 0,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {situation.downDistanceText}
          </div>
        ) : null}
      </div>
    </>
  );
}

/* ----------------------------------------------------------------- tabs --- */

type TabId = "gamecast" | "box" | "plays" | "stats";

const TAB_LABELS: [TabId, string][] = [
  ["gamecast", "Gamecast"],
  ["box", "Box"],
  ["plays", "Plays"],
  ["stats", "Stats"],
];

/**
 * Four ways into the same game, on a rail that stays put as the page scrolls.
 *
 * Sticky because the tabs are how you get back out of a two-hundred-play list,
 * and a control you have to scroll to the top to reach is one nobody uses
 * twice.
 */
function Tabs({
  value,
  onChange,
  counts,
}: {
  value: TabId;
  onChange: (id: TabId) => void;
  counts: { box: number; plays: number };
}) {
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 5,
        background: "var(--bg)",
        padding: "2px 14px 10px",
      }}
    >
      <div
        role="tablist"
        style={{
          display: "flex",
          gap: 2,
          background: "rgb(var(--sunken-rgb) / .8)",
          borderRadius: "var(--radius-md)",
          padding: 3,
          boxShadow: "none",
        }}
      >
        {TAB_LABELS.map(([id, label]) => {
          const on = id === value;
          // A tab that opens an empty page is worse than one that is not
          // offered: it reads as the app being broken rather than the game
          // being young.
          const empty =
            (id === "box" && counts.box === 0) || (id === "plays" && counts.plays === 0);
          return (
            <button
              key={id}
              role="tab"
              aria-selected={on}
              onClick={() => onChange(id)}
              style={{
                flex: 1,
                minWidth: 0,
                height: 38,
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
                background: on ? "rgb(var(--surface-rgb) / .55)" : "transparent",
                boxShadow: on ? "0 1px 2px rgb(0 0 0 / .18)" : "none",
                font: `${on ? 600 : 500} 11px/1 inherit`,
                color: on
                  ? "var(--text)"
                  : empty
                    ? "var(--text-faint)"
                    : "var(--text-muted)",
                padding: "0 2px",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        ...SURFACE,
        padding: "22px 16px",
        textAlign: "center",
        font: "400 12.5px/1.5 inherit",
        color: "var(--text-muted)",
      }}
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------- gamecast --- */

/**
 * The most recent play, given its own card.
 *
 * On a live game this is the line somebody opens the screen for — what just
 * happened — and in the list below it is one row of two hundred.
 */
function LastPlay({ play }: { play: GamecastPlay }) {
  return (
    <div style={{ ...SURFACE, padding: 13 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 8 }}>
        <span style={{ font: "600 9.5px/1 inherit", letterSpacing: ".1em", color: "var(--accent-link)" }}>
          LAST PLAY
        </span>
        <span
          style={{
            flex: 1,
            height: 1,
            background: "linear-gradient(90deg,rgb(var(--accent-rgb) / .22),transparent)",
          }}
        />
        <span style={{ font: "400 10px/1 inherit", color: "var(--text-dim)" }}>
          Q{play.period} · {play.clock}
        </span>
      </div>
      <div style={{ font: "400 13px/1.5 inherit", color: "var(--text-2)" }}>
        {play.text}
      </div>
    </div>
  );
}

/** Every play that changed the score, in ESPN's own words. */
function ScoringSummary({ scoring }: { scoring: ScoringPlay[] }) {
  return (
    <div>
      <div style={{ ...EYEBROW, margin: "6px 2px 8px" }}>SCORING SUMMARY</div>
      <div style={{ ...SURFACE, overflow: "hidden" }}>
        {scoring.map((s, i) => (
          <div
            key={`${s.team}-${i}`}
            style={{
              display: "flex",
              gap: 11,
              padding: "11px 13px",
              borderTop: i === 0 ? undefined : "1px solid rgb(var(--sunken-rgb) / .8)",
            }}
          >
            <div style={{ width: 30, flex: "none", display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
              <span style={{ font: "700 9px/1 inherit", color: "var(--text-muted)" }}>
                {s.team}
              </span>
              <span style={{ font: "400 9px/1 inherit", color: "var(--text-faint)" }}>
                {s.type}
              </span>
            </div>
            <div style={{ flex: 1, minWidth: 0, font: "400 11.5px/1.45 inherit", color: "var(--text-2)" }}>
              {s.text}
            </div>
            <div
              style={{
                font: "500 11px/1.3 inherit",
                fontVariantNumeric: "tabular-nums",
                color: "var(--text-3)",
                flex: "none",
              }}
            >
              +{s.value}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Everything that happened, newest first. */
function PlayList({ plays }: { plays: GamecastPlay[] }) {
  return (
    <div style={{ ...SURFACE, overflow: "hidden" }}>
      {plays.map((p, i) => (
        <div
          key={p.id}
          style={{
            display: "flex",
            gap: 10,
            padding: "9px 13px",
            borderTop: i === 0 ? undefined : "1px solid rgb(var(--sunken-rgb) / .8)",
            background: p.scoring ? "rgb(var(--accent-rgb) / .14)" : undefined,
          }}
        >
          <span
            style={{
              font: "600 9.5px/1.4 inherit",
              color: p.scoring ? "var(--accent-link)" : "var(--text-dim)",
              flex: "0 0 auto",
              minWidth: 48,
              fontVariantNumeric: "tabular-nums",
              whiteSpace: "nowrap",
            }}
          >
            Q{p.period} {p.clock}
          </span>
          <span style={{ font: "400 11.5px/1.5 inherit", color: "var(--text-2)", minWidth: 0 }}>
            {p.text}
          </span>
        </div>
      ))}
    </div>
  );
}
