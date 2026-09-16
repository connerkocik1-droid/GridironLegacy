"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  keyOf,
  moveLabel,
  type BoardReport,
  type Entry,
  type Move,
} from "@/lib/pylon-report";

/**
 * The Pylon Report, on the home page.
 *
 * One small departure before the large one: the handoff draws its micro-labels
 * at seven to nine pixels and every one of them here is ten, which is the
 * floor the mobile audit holds the rest of the app to. The same call was taken
 * porting the week recap, and for the same reason — a label somebody has to
 * lean in for is a label the screen did not say.
 *
 * Ported from the handoff's design with one deliberate departure, which the
 * handoff itself asks to be decided: its prototype *computes* the board from
 * results, a rating formula and a decaying preseason weight, and generates
 * every sentence on the screen. This league's report is not that. The
 * commissioner writes it — a ranking he argues for and a paragraph a formula
 * could not produce ("I'm all in on the Giants. But they have to stay
 * healthy") — and pastes it in each week.
 *
 * So the board is an input rather than an output, which is the fork the
 * handoff names under "Poll vs. computed board". What that costs is the parts
 * of the prototype that are functions of a rating this app does not have: the
 * four input bars, the strength-of-schedule cell, the résumé and the
 * methodology panel. Drawing those with nothing behind them would be a
 * screenful of invented authority.
 *
 * What survives is everything the design is actually for — the spotlight on
 * No. 1, the riser and faller, ranks two to fifteen as tap-to-expand rows with
 * the movement chip against the rank — and one thing the prototype has no
 * equivalent for, because this report has it: the five honourable mentions.
 *
 * The movement is still real and still not stored: it is last week's published
 * board against this week's, which is the same relationship the prototype has
 * between two computed boards.
 */

interface Report {
  week: number;
  publishedAt: string;
  against: number | null;
  college: BoardReport;
  nfl: BoardReport;
  moves: { college: Record<string, Move>; nfl: Record<string, Move> };
}

const BOARDS = [
  { key: "college", label: "College Football", list: "TOP 15 POLL 2-15", crown: "NO. 1 IN THE POLL" },
  { key: "nfl", label: "NFL", list: "POWER RANKINGS 2-15", crown: "NO. 1 POWER RANK" },
] as const;

type BoardKey = (typeof BOARDS)[number]["key"];

export default function PylonReport() {
  const [report, setReport] = useState<Report | null>(null);
  const [board, setBoard] = useState<BoardKey>("nfl");
  const [open, setOpen] = useState<string | null>(null);
  const [asked, setAsked] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/report", { cache: "no-store" });
      if (res.ok) {
        const body = await res.json();
        setReport((body.report as Report | null) ?? null);
      }
    } catch {
      // A column nobody can fetch is a column that does not appear. There is
      // nothing to tell a manager about that — the app behind it is intact.
    } finally {
      setAsked(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Whichever board actually has something on it, so a week where only one was
  // pasted opens on the one that was.
  const showing = useMemo(() => {
    if (!report) return null;
    const asked = BOARDS.find((b) => b.key === board)!;
    if (report[asked.key].ranked.length) return asked;
    return BOARDS.find((b) => report[b.key].ranked.length) ?? null;
  }, [report, board]);

  const moves = showing && report ? report.moves?.[showing.key] : undefined;

  /** The biggest climb and the biggest fall, straight out of the two boards. */
  const movers = useMemo(() => {
    if (!report || !showing || !moves) return null;
    const all = [...report[showing.key].ranked, ...report[showing.key].honorable];

    let up: { entry: Entry; places: number } | null = null;
    let down: { entry: Entry; places: number } | null = null;
    for (const entry of all) {
      const move = moves[keyOf(entry.team)];
      if (move?.kind === "up" && (!up || move.places > up.places)) up = { entry, places: move.places };
      if (move?.kind === "down" && (!down || move.places > down.places)) {
        down = { entry, places: move.places };
      }
    }
    // Both or neither. One mover on its own in a two-column grid is a hole.
    return up && down ? { up, down } : null;
  }, [report, showing, moves]);

  if (!asked || !report || !showing) return null;

  const current = report[showing.key];
  const top = current.ranked[0] ?? null;
  const rest = current.ranked.slice(1);

  return (
    <div style={{ padding: "0 18px" }}>
      <div
        data-report="pylon"
        style={{
          border: "1px solid rgb(var(--accent-rgb) / .22)",
          borderRadius: 16,
          overflow: "hidden",
          // The prototype's two washes, kept: they are what make this read as
          // its own publication rather than as another card on Home.
          background:
            "radial-gradient(420px 280px at 8% -6%, rgb(var(--reveal-rgb) / .5) 0%, transparent 62%)," +
            "radial-gradient(320px 240px at 108% 10%, rgb(var(--glow-rgb) / .45) 0%, transparent 60%)," +
            "rgb(var(--surface-rgb) / .6)",
        }}
      >
        <div style={{ padding: "14px 15px 0" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            {/* The pylon. The one piece of the app that is a mark rather than
                a word, and the reason the column has a name. */}
            <span
              aria-hidden
              style={{
                flex: "0 0 auto",
                width: 8,
                height: 18,
                clipPath: "polygon(28% 0,100% 0,72% 100%,0 100%)",
                background: "linear-gradient(180deg,#ffb066,#e0682a)",
                boxShadow: "0 0 14px rgba(224,104,42,.55)",
              }}
            />
            <span
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: 17,
                lineHeight: 1,
                letterSpacing: "-.02em",
                minWidth: 0,
                flex: 1,
              }}
            >
              The Pylon Report
            </span>
            <span
              className="pr-pulse"
              aria-hidden
              style={{
                width: 5,
                height: 5,
                borderRadius: "50%",
                flex: "0 0 auto",
                background: "var(--good)",
                boxShadow: "0 0 8px var(--good)",
              }}
            />
            <span
              style={{
                fontSize: 10,
                letterSpacing: ".1em",
                color: "var(--text-dim)",
                flex: "0 0 auto",
              }}
            >
              {`THROUGH WEEK ${report.week}`}
            </span>
          </div>

          <div role="tablist" aria-label="Which board" style={{ display: "flex", gap: 4, marginTop: 11 }}>
            {BOARDS.map((b) => {
              const on = showing.key === b.key;
              const has = report[b.key].ranked.length > 0;
              return (
                <button
                  key={b.key}
                  role="tab"
                  aria-selected={on}
                  disabled={!has}
                  onClick={() => {
                    setBoard(b.key);
                    setOpen(null);
                  }}
                  style={{
                    cursor: has ? "pointer" : "default",
                    flex: 1,
                    fontFamily: "var(--font-body)",
                    fontSize: 10,
                    letterSpacing: ".1em",
                    padding: "9px 4px",
                    borderRadius: "8px 8px 0 0",
                    border: 0,
                    background: on ? "rgb(var(--accent-rgb) / .18)" : "transparent",
                    color: has ? (on ? "var(--text)" : "var(--text-dim)") : "var(--text-off)",
                    boxShadow: on ? "inset 0 -2px 0 var(--accent-link)" : "none",
                  }}
                >
                  {b.label}
                </button>
              );
            })}
          </div>
          <div style={{ height: 1, background: "rgb(var(--accent-rgb) / .2)" }} />
        </div>

        <div style={{ padding: "14px 15px 18px" }}>
          {top ? (
            <div
              className="pr-rise"
              style={{
                border: "1px solid rgb(var(--accent-rgb) / .32)",
                borderRadius: 14,
                overflow: "hidden",
                background:
                  "linear-gradient(160deg, rgb(var(--reveal-rgb) / .9), rgb(var(--raised-rgb) / .87))",
                position: "relative",
                boxShadow: "0 14px 32px rgb(var(--scrim-rgb) / .42)",
              }}
            >
              <div
                className="pr-sweep"
                aria-hidden
                style={{
                  position: "absolute",
                  inset: 0,
                  pointerEvents: "none",
                  background:
                    "linear-gradient(115deg,transparent 44%,rgb(var(--accent-bright-rgb) / .13) 50%,transparent 56%)",
                  backgroundSize: "220% 100%",
                }}
              />
              <div style={{ padding: 13, position: "relative" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
                  <span
                    aria-hidden
                    style={{
                      width: 44,
                      height: 44,
                      flex: "0 0 auto",
                      borderRadius: 11,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontFamily: "var(--font-heading)",
                      fontSize: 12,
                      letterSpacing: ".04em",
                      color: "var(--bg)",
                      background: "linear-gradient(150deg,var(--accent-link),var(--accent-deep))",
                      border: "1.5px solid rgb(var(--accent-bright-rgb) / .7)",
                    }}
                  >
                    {monogram(top.team)}
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--accent-link)" }}>
                      {showing.crown}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-heading)",
                        fontSize: 17,
                        lineHeight: 1.15,
                        letterSpacing: "-.025em",
                        marginTop: 4,
                      }}
                    >
                      {top.team}
                    </div>
                    <div
                      style={{
                        fontSize: 10,
                        letterSpacing: ".1em",
                        color: "var(--text-dim)",
                        marginTop: 4,
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                      }}
                    >
                      {top.record ? <span>{top.record}</span> : null}
                      <Chip move={moves?.[keyOf(top.team)]} />
                    </div>
                  </div>
                </div>
                {top.note ? (
                  <div
                    style={{
                      fontSize: 11,
                      lineHeight: 1.5,
                      color: "var(--text-muted)",
                      marginTop: 11,
                    }}
                  >
                    {top.note}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          {movers ? (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
                marginTop: 10,
              }}
            >
              <Mover label="BIGGEST RISER" entry={movers.up.entry} places={movers.up.places} up />
              <Mover label="BIGGEST FALLER" entry={movers.down.entry} places={movers.down.places} />
            </div>
          ) : null}

          <div style={{ display: "flex", alignItems: "baseline", padding: "18px 0 9px" }}>
            <span style={{ fontSize: 10, letterSpacing: ".28em", color: "var(--text-dim)" }}>
              {showing.list}
            </span>
            <span
              style={{ marginLeft: "auto", fontSize: 10, letterSpacing: ".12em", color: "var(--text-faint)" }}
            >
              {report.against == null ? "FIRST OF THE SEASON" : `VS WEEK ${report.against}`}
            </span>
          </div>

          <div
            style={{
              border: "1px solid rgb(var(--accent-rgb) / .2)",
              borderRadius: 14,
              overflow: "hidden",
              background: "rgb(var(--raised-rgb) / .72)",
            }}
          >
            {rest.map((entry, n) => (
              <Row
                key={`${entry.rank}-${entry.team}`}
                entry={entry}
                move={moves?.[keyOf(entry.team)]}
                first={n === 0}
                open={open === keyOf(entry.team)}
                onToggle={() => setOpen(open === keyOf(entry.team) ? null : keyOf(entry.team))}
              />
            ))}
          </div>

          {current.honorable.length ? (
            <>
              <div style={{ fontSize: 10, letterSpacing: ".28em", color: "var(--text-dim)", padding: "16px 0 9px" }}>
                HONORABLE MENTION
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {current.honorable.map((entry) => (
                  <span
                    key={`${entry.rank}-${entry.team}`}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11.5,
                      padding: "6px 10px",
                      borderRadius: 11,
                      border: "1px solid rgb(var(--accent-rgb) / .2)",
                      background: "rgb(var(--raised-rgb) / .6)",
                    }}
                  >
                    {entry.team}
                    <Chip move={moves?.[keyOf(entry.team)]} />
                  </span>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** One of ranks two to fifteen, with its write-up behind it. */
function Row({
  entry,
  move,
  first,
  open,
  onToggle,
}: {
  entry: Entry;
  move: Move | undefined;
  first: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  const has = entry.note.length > 0;

  return (
    <div
      style={{
        borderTop: first ? undefined : "1px solid rgb(var(--accent-rgb) / .13)",
        background: open ? "rgb(var(--accent-rgb) / .07)" : undefined,
        boxShadow: open ? "inset 2px 0 0 var(--accent-link)" : undefined,
      }}
    >
      <button
        onClick={has ? onToggle : undefined}
        aria-expanded={has ? open : undefined}
        {...(has ? {} : { tabIndex: -1, "aria-disabled": true })}
        style={{
          width: "100%",
          display: "flex",
          alignItems: "center",
          gap: 11,
          padding: "11px 13px",
          minHeight: 44,
          background: "none",
          border: 0,
          textAlign: "left",
          color: "inherit",
          cursor: has ? "pointer" : "default",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 14,
            color: "var(--text-dim)",
            width: 20,
            flex: "0 0 auto",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {entry.rank}
        </span>

        <Chip move={move} wide />

        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 13,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {entry.team}
          </div>
          {entry.record ? (
            <div style={{ fontSize: 10, letterSpacing: ".1em", color: "var(--text-dim)", marginTop: 3 }}>
              {entry.record}
            </div>
          ) : null}
        </div>

        {has ? (
          <span
            aria-hidden
            style={{
              fontSize: 15,
              flex: "0 0 auto",
              color: "var(--text-faint)",
              transition: "transform .2s ease",
              transform: open ? "rotate(90deg)" : "none",
            }}
          >
            ›
          </span>
        ) : null}
      </button>

      {open && has ? (
        <div className="pr-rise-quick" style={{ padding: "0 13px 14px" }}>
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              background: "rgb(var(--accent-rgb) / .1)",
              border: "1px solid rgb(var(--accent-rgb) / .2)",
              fontSize: 11,
              lineHeight: 1.55,
              color: "var(--accent-text)",
            }}
          >
            {entry.note}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** The biggest climb, or the biggest fall. */
function Mover({
  label,
  entry,
  places,
  up = false,
}: {
  label: string;
  entry: Entry;
  places: number;
  up?: boolean;
}) {
  return (
    <div
      style={{
        padding: "10px 11px",
        borderRadius: 11,
        border: `1px solid ${up ? "rgb(var(--good-rgb) / .28)" : "rgb(var(--bad-rgb) / .26)"}`,
        background: up ? "rgb(var(--good-rgb) / .08)" : "rgb(var(--bad-rgb) / .08)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 10, letterSpacing: ".14em", color: up ? "var(--good)" : "var(--bad-text)" }}>
          {label}
        </span>
        <span
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: 11,
            marginLeft: "auto",
            color: up ? "var(--good)" : "var(--bad-text)",
          }}
        >
          {`${up ? "▲" : "▼"}${places}`}
        </span>
      </div>
      <div
        style={{
          fontSize: 11,
          lineHeight: 1.2,
          marginTop: 6,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {entry.team}
      </div>
      <div style={{ fontSize: 10, letterSpacing: ".1em", color: "var(--text-dim)", marginTop: 3 }}>
        {`NO. ${up ? entry.rank + places : entry.rank - places} → NO. ${entry.rank}`}
      </div>
    </div>
  );
}

/**
 * The movement chip.
 *
 * Direction and colour both, because neither survives on its own: two
 * triangles in colours a reader cannot tell apart say only that something
 * happened, and a colour with no shape says nothing to anybody reading it in
 * greyscale. A team that held gets an em dash — silence there reads as a
 * column that failed to load rather than as a team that did not move.
 */
function Chip({ move, wide = false }: { move: Move | undefined; wide?: boolean }) {
  const label = moveLabel(move);
  if (!move) return wide ? <span style={{ width: 26, flex: "0 0 auto" }} /> : null;

  const common: React.CSSProperties = {
    fontFamily: "var(--font-heading)",
    fontSize: wide ? 10 : 9.5,
    flex: "0 0 auto",
    ...(wide ? { width: 26, textAlign: "center" as const } : {}),
    fontVariantNumeric: "tabular-nums",
  };

  if (move.kind === "held") {
    return (
      <span role="img" aria-label={label} style={{ ...common, color: "var(--text-faint)" }}>
        —
      </span>
    );
  }

  if (move.kind === "new") {
    return (
      <span
        role="img"
        aria-label={label}
        style={{
          ...common,
          fontSize: 10,
          letterSpacing: ".1em",
          width: wide ? 26 : undefined,
          color: "var(--accent-link)",
        }}
      >
        NEW
      </span>
    );
  }

  const up = move.kind === "up";
  return (
    <span
      role="img"
      aria-label={label}
      style={{ ...common, color: up ? "var(--good)" : "var(--bad-text)" }}
    >
      {`${up ? "▲" : "▼"}${move.places}`}
    </span>
  );
}

/**
 * A crest for a team the app knows nothing about but its name.
 *
 * The prototype carries an abbreviation per team because its team list is
 * written into the file. This one's teams arrive in a paste, so the mark is
 * derived: the initials of the words that are words, or the first three
 * letters of a name that is one word. "San Francisco 49ers" is SF, "Georgia"
 * is GEO. Never wrong, because it never claims to be the official one.
 */
function monogram(team: string): string {
  const words = team.trim().split(/\s+/).filter((w) => /^[A-Za-z]/.test(w));
  if (words.length >= 2) return words.slice(0, 3).map((w) => w[0].toUpperCase()).join("");
  return (words[0] ?? team).slice(0, 3).toUpperCase();
}
