import Link from "next/link";
import HeaderMark from "./HeaderMark";
import { keyOf, moveLabel, type BoardReport, type Entry, type Move, type Polls } from "@/lib/pylon-report";
import type { ProspectBoard, ProspectEntry } from "@/lib/pylon-draft-board";

/**
 * The Pylon Report, in full — no sign-in needed, and no tab bar either: a
 * visitor who followed a shared link is not a manager picking between My
 * Team and the Draft, and a bar of auth-gated tabs would just bounce them to
 * sign-in. A lighter header, the whole report stacked top to bottom, and a
 * way back to the app for anybody who already has an account.
 */
export default function PylonReportPage({
  week,
  publishedAt,
  college,
  nfl,
  polls,
  collegeMoves,
  nflMoves,
  bigBoard,
  bigBoardWeek,
  bigBoardMoves,
}: {
  week: number | null;
  publishedAt: string | null;
  college: BoardReport;
  nfl: BoardReport;
  polls: Polls;
  collegeMoves: Record<string, Move>;
  nflMoves: Record<string, Move>;
  bigBoard: ProspectBoard;
  bigBoardWeek: number | null;
  bigBoardMoves: Record<string, Move>;
}) {
  const nothing = !college.ranked.length && !nfl.ranked.length && !bigBoard.ranked.length;

  return (
    <div
      style={{
        minHeight: "var(--screen)",
        background:
          "radial-gradient(120% 80% at 50% -10%,rgb(var(--glow-rgb) / .4),transparent 60%),var(--bg)",
      }}
    >
      <header
        style={{
          padding: "20px 20px 16px",
          borderBottom: "1px solid rgb(var(--accent-rgb) / .22)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <Link href="/" style={{ color: "inherit" }}>
          <HeaderMark />
        </Link>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontFamily: "var(--font-heading)", fontSize: 19, letterSpacing: "-.02em" }}>
            The Pylon Report
          </div>
          <div style={{ fontSize: 10, letterSpacing: ".14em", color: "var(--text-dim)", marginTop: 2 }}>
            {week != null ? `THROUGH WEEK ${week}` : "NOT PUBLISHED YET"}
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 640, margin: "0 auto", padding: "20px 18px 60px" }}>
        {nothing ? (
          <p style={{ fontSize: 13, color: "var(--text-muted)", textAlign: "center", marginTop: 60 }}>
            Nothing published yet. Check back after the commissioner&apos;s office puts this week&apos;s boards up.
          </p>
        ) : (
          <>
            <Section title="College Football" subtitle={publishedAt ? forWeekLabel(week) : undefined}>
              <Board entries={college.ranked} moves={collegeMoves} />
              <PollsTable polls={polls} />
            </Section>

            <Section title="NFL Power Rankings">
              <Board entries={nfl.ranked} moves={nflMoves} />
            </Section>

            <Section
              title="2027 Big Board"
              subtitle={bigBoardWeek != null ? `WEEK ${bigBoardWeek}` : undefined}
            >
              <ProspectBoardList entries={bigBoard.ranked} moves={bigBoardMoves} />
            </Section>
          </>
        )}
      </main>
    </div>
  );
}

function forWeekLabel(week: number | null): string {
  return week != null ? `WEEK ${week}` : "";
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{ marginTop: 28 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
        <h2
          style={{
            margin: 0,
            fontFamily: "var(--font-heading)",
            fontSize: 16,
            letterSpacing: "-.01em",
          }}
        >
          {title}
        </h2>
        {subtitle ? (
          <span style={{ fontSize: 10, letterSpacing: ".14em", color: "var(--text-dim)" }}>{subtitle}</span>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function Board({ entries, moves }: { entries: Entry[]; moves: Record<string, Move> }) {
  if (!entries.length) {
    return <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Not ranked yet.</div>;
  }
  return (
    <div
      style={{
        border: "1px solid rgb(var(--accent-rgb) / .2)",
        borderRadius: 14,
        overflow: "hidden",
        background: "rgb(var(--raised-rgb) / .6)",
      }}
    >
      {entries.map((entry, i) => (
        <div
          key={`${entry.rank}-${entry.team}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            padding: "10px 13px",
            minHeight: 42,
            borderTop: i === 0 ? undefined : "1px solid rgb(var(--accent-rgb) / .12)",
          }}
        >
          <span style={numCol}>{entry.rank}</span>
          <Chip move={moves[keyOf(entry.team)]} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={nameRow}>{entry.team}</div>
            {entry.record ? <div style={subRow}>{entry.record}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function ProspectBoardList({ entries, moves }: { entries: ProspectEntry[]; moves: Record<string, Move> }) {
  if (!entries.length) {
    return <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Not published yet.</div>;
  }
  return (
    <div
      style={{
        border: "1px solid rgb(var(--accent-rgb) / .2)",
        borderRadius: 14,
        overflow: "hidden",
        background: "rgb(var(--raised-rgb) / .6)",
      }}
    >
      {entries.map((entry, i) => (
        <div
          key={`${entry.rank}-${entry.player}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 11,
            padding: "10px 13px",
            minHeight: 42,
            borderTop: i === 0 ? undefined : "1px solid rgb(var(--accent-rgb) / .12)",
          }}
        >
          <span style={numCol}>{entry.rank}</span>
          <Chip move={moves[keyOf(entry.player)]} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={nameRow}>{entry.player}</div>
            {entry.position || entry.college ? (
              <div style={subRow}>{[entry.position, entry.college].filter(Boolean).join(" · ")}</div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/** AP, Coaches and CFP, side by side with the commissioner's own board above them. */
function PollsTable({ polls }: { polls: Polls }) {
  const depth = Math.max(polls.ap.length, polls.coaches.length, polls.cfp.length);
  if (!depth) return null;

  const at = (list: Polls["ap"], rank: number) => list.find((e) => e.rank === rank)?.team ?? "—";

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--text-dim)", marginBottom: 6 }}>
        AP · COACHES · CFP
      </div>
      <div
        style={{
          border: "1px solid rgb(var(--accent-rgb) / .2)",
          borderRadius: 12,
          overflow: "hidden",
          background: "rgb(var(--sunken-rgb) / .5)",
        }}
      >
        <div style={{ ...pollRow, color: "var(--text-dim)", fontSize: 10, letterSpacing: ".1em" }}>
          <span style={{ width: 22, flex: "0 0 auto" }}>#</span>
          <span style={{ flex: 1 }}>AP</span>
          <span style={{ flex: 1 }}>Coaches</span>
          <span style={{ flex: 1 }}>CFP</span>
        </div>
        {Array.from({ length: depth }, (_, i) => i + 1).map((rank, i) => (
          <div
            key={rank}
            style={{ ...pollRow, borderTop: i === 0 ? undefined : "1px solid rgb(var(--accent-rgb) / .1)" }}
          >
            <span style={{ width: 22, flex: "0 0 auto", fontVariantNumeric: "tabular-nums" }}>{rank}</span>
            <span style={pollCell}>{at(polls.ap, rank)}</span>
            <span style={pollCell}>{at(polls.coaches, rank)}</span>
            <span style={pollCell}>{at(polls.cfp, rank)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const pollRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "7px 12px",
  fontSize: 11.5,
};

const pollCell: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const numCol: React.CSSProperties = {
  fontFamily: "var(--font-heading)",
  fontSize: 13,
  color: "var(--text-dim)",
  width: 20,
  flex: "0 0 auto",
  fontVariantNumeric: "tabular-nums",
};

const nameRow: React.CSSProperties = {
  fontSize: 13,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const subRow: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: ".08em",
  color: "var(--text-dim)",
  marginTop: 2,
};

/** Same movement vocabulary as the home widget's — see pylon-report.ts's Move. */
function Chip({ move }: { move: Move | undefined }) {
  const label = moveLabel(move);
  if (!move) return <span style={{ width: 26, flex: "0 0 auto" }} />;

  const common: React.CSSProperties = {
    fontFamily: "var(--font-heading)",
    fontSize: 10,
    width: 26,
    textAlign: "center",
    flex: "0 0 auto",
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
      <span role="img" aria-label={label} style={{ ...common, letterSpacing: ".06em", color: "var(--accent-link)" }}>
        NEW
      </span>
    );
  }
  const up = move.kind === "up";
  return (
    <span role="img" aria-label={label} style={{ ...common, color: up ? "var(--good)" : "var(--bad-text)" }}>
      {`${up ? "▲" : "▼"}${move.places}`}
    </span>
  );
}
