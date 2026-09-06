"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import LiveNumber from "./LiveNumber";
import PlayerName from "./PlayerName";
import Skeleton from "./Skeleton";
import TeamMark from "./TeamMark";
import { useMe } from "@/lib/use-me";
import { useRefreshable } from "@/lib/use-refresh";
import type { BoxTeam, Gamecast, OwnedPlayer } from "@/lib/gamecast";
import type { Game } from "@/lib/espn";

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

  return (
    <div style={{ padding: "20px 26px 40px" }}>
      <Link
        href="/"
        style={{
          fontSize: 11,
          letterSpacing: ".16em",
          color: "var(--text-dim)",
          textDecoration: "none",
          display: "inline-flex",
          alignItems: "center",
          minHeight: 34,
        }}
      >
        ‹ THE SLATE
      </Link>

      {game ? <Scoreline game={game} /> : null}

      {board.error ? (
        <div style={{ fontSize: 12.5, color: "var(--warn)", marginTop: 12 }}>{board.error}</div>
      ) : null}

      {owned.length ? (
        <Section title="Who is in this game" note={`${owned.length} rostered`}>
          {owned.map((p) => (
            <PlayerRow key={`${p.name}-${p.team}`} player={p} mine={p.managerId === mine} />
          ))}
        </Section>
      ) : game && game.state !== "pre" ? (
        <Section title="Who is in this game" note="nobody">
          <div style={{ padding: "13px 16px", fontSize: 12.5, color: "var(--text-dim)" }}>
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

      {board.scoring.length ? (
        <Section title="Scoring" note={`${board.scoring.length}`}>
          {board.scoring.map((s, i) => (
            <div
              key={`${s.team}-${i}`}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 10,
                padding: "10px 16px",
                borderTop: i === 0 ? undefined : "1px solid rgb(var(--accent-rgb) / .12)",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 11,
                  color: "var(--accent-link)",
                  flex: "0 0 auto",
                  minWidth: 30,
                }}
              >
                {s.team}
              </span>
              <span style={{ fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.5, minWidth: 0 }}>
                {s.text}
              </span>
            </div>
          ))}
        </Section>
      ) : null}

      {board.box.length ? (
        <BoxScore box={board.box} totals={board.teamTotals} game={game} />
      ) : null}

      {board.plays.length ? (
        <Section title="What happened" note="newest first">
          {board.plays.map((p) => (
            <div
              key={p.id}
              style={{
                display: "flex",
                gap: 10,
                padding: "9px 16px",
                borderTop: "1px solid rgb(var(--accent-rgb) / .1)",
                background: p.scoring ? "rgb(var(--accent-rgb) / .1)" : undefined,
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  letterSpacing: ".08em",
                  color: "var(--text-dim)",
                  flex: "0 0 auto",
                  minWidth: 52,
                  fontVariantNumeric: "tabular-nums",
                  // A quarter and a clock are one token each.
                  whiteSpace: "nowrap",
                }}
              >
                Q{p.period} {p.clock}
              </span>
              <span style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.5, minWidth: 0 }}>
                {p.text}
              </span>
            </div>
          ))}
        </Section>
      ) : null}
    </div>
  );
}

/** The score, and what state the game is in. */
function Scoreline({ game }: { game: Game }) {
  const live = game.state === "in";

  return (
    <div
      style={{
        border: `1px solid ${live ? "rgb(var(--good-rgb) / .4)" : "rgb(var(--accent-rgb) / .22)"}`,
        borderRadius: "var(--radius-lg)",
        background: "rgb(var(--surface-rgb) / .55)",
        padding: "14px 16px",
        marginTop: 10,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 10,
          letterSpacing: ".18em",
          color: live ? "var(--good)" : "var(--text-dim)",
          marginBottom: 11,
        }}
      >
        {live ? (
          <span
            className="gl-live-dot"
            aria-hidden
            style={{ flex: "0 0 auto", width: 7, height: 7, borderRadius: "50%", background: "var(--good)" }}
          />
        ) : null}
        <span style={{ whiteSpace: "nowrap" }}>{game.statusDetail || "SCHEDULED"}</span>
      </div>

      {[game.away, game.home].map((side, i) =>
        side ? (
          <Side key={side.abbrev} abbrev={side.abbrev} name={side.name} score={side.score}
            leading={
              game.away != null && game.home != null &&
              side.score > (i === 0 ? game.home.score : game.away.score)
            }
            first={i === 0}
          />
        ) : null,
      )}
    </div>
  );
}

function Side({
  abbrev,
  name,
  score,
  leading,
  first,
}: {
  abbrev: string;
  name: string;
  score: number;
  leading: boolean;
  first: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginTop: first ? 0 : 9,
        minWidth: 0,
      }}
    >
      <TeamMark team={abbrev} size={20} opacity={1} />
      <span
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 15,
          color: leading ? "var(--text)" : "var(--text-2)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
          flex: 1,
        }}
      >
        {name}
      </span>
      <span
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 26,
          color: leading ? "var(--accent-text)" : "var(--text-3)",
          fontVariantNumeric: "tabular-nums",
          whiteSpace: "nowrap",
        }}
      >
        <LiveNumber value={score} decimals={0} />
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

  return (
    <div style={{ padding: "12px 16px 14px" }}>
      <div style={{ ...totalsRow, color: "var(--text-dim)", fontSize: 10, letterSpacing: ".1em" }}>
        <span style={{ ...totalsSide, fontFamily: "var(--font-heading)" }}>{away}</span>
        <span />
        <span style={{ ...totalsSide, fontFamily: "var(--font-heading)" }}>{home}</span>
      </div>

      {rows.map(([key, label]) => (
        <div key={key} style={totalsRow}>
          <span style={{ ...totalsSide, color: "var(--text-2)" }}>{totals[away]?.[key] ?? "—"}</span>
          <span
            style={{
              fontSize: 11,
              color: "var(--text-dim)",
              textAlign: "center",
              minWidth: 0,
              overflowWrap: "anywhere",
            }}
          >
            {label}
          </span>
          <span style={{ ...totalsSide, color: "var(--text-2)" }}>{totals[home]?.[key] ?? "—"}</span>
        </div>
      ))}
    </div>
  );
}

const totalsRow: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0,1fr) minmax(0,1.3fr) minmax(0,1fr)",
  alignItems: "baseline",
  gap: 8,
  padding: "5px 0",
};

const totalsSide: React.CSSProperties = {
  fontSize: 13,
  fontVariantNumeric: "tabular-nums",
  textAlign: "center",
  whiteSpace: "nowrap",
  minWidth: 0,
};
