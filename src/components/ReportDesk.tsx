"use client";

import { useMemo, useState } from "react";
import {
  joinBreakdowns,
  parseBreakdowns,
  parseRankings,
  summarise,
  type BoardReport,
} from "@/lib/pylon-report";

/**
 * Where the week's Pylon Report is pasted in.
 *
 * Two boxes because the commissioner has two documents: a spreadsheet of ranks
 * and a write-up of paragraphs. Asking for them to be merged by hand first
 * would be asking somebody to do a join a computer is better at.
 *
 * Everything is parsed here, in front of him, before anything is published.
 * That is the whole design: a paste either shows fifteen teams with their
 * write-ups attached, or it says which line it could not read and which
 * paragraph found nobody — and the second of those is the one that matters,
 * because a breakdown that silently fails to land is writing nobody reads.
 */
export default function ReportDesk({
  week,
  onPublished,
}: {
  /** The week the league is on, which is the one this is about. */
  week: number | null;
  onPublished?: () => void;
}) {
  const [forWeek, setForWeek] = useState<string>(week == null ? "1" : String(week));
  const [grid, setGrid] = useState("");
  const [writeUp, setWriteUp] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const parsed = useMemo(() => {
    const rankings = parseRankings(grid);
    const notes = parseBreakdowns(writeUp);

    const college = joinBreakdowns(rankings.college, notes.college);
    const nfl = joinBreakdowns(rankings.nfl, notes.nfl);

    return {
      rankings,
      college: college.board,
      nfl: nfl.board,
      unmatched: [...college.unmatched, ...nfl.unmatched],
    };
  }, [grid, writeUp]);

  const anything = parsed.college.ranked.length > 0 || parsed.nfl.ranked.length > 0;

  async function publish(remove = false) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          remove
            ? { week: Number(forWeek), remove: true }
            : { week: Number(forWeek), college: parsed.college, nfl: parsed.nfl },
        ),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "That did not publish.");
      else {
        setNotice(
          remove
            ? `Week ${forWeek} is down.`
            : `Week ${forWeek} is up. Everybody sees it on the home page.`,
        );
        if (!remove) {
          setGrid("");
          setWriteUp("");
        }
        onPublished?.();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div id="office-report" style={card}>
      <h6 style={{ margin: "0 0 4px", color: "var(--accent-text)" }}>The Pylon Report</h6>
      <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 12px" }}>
        Paste the rankings sheet into the first box and the write-up into the
        second. The sheet can be both boards side by side, the way it is kept —
        a rank, a team and a record per column pair. Rows sixteen to twenty are
        the honourable mentions. Nothing is published until you press the
        button, and what it would publish is shown underneath.
      </p>

      <label style={label}>
        Week
        <input
          type="number"
          min={1}
          value={forWeek}
          onChange={(e) => setForWeek(e.target.value)}
          style={numberField}
        />
      </label>

      <label style={{ ...label, display: "block", marginTop: 12 }}>
        Rankings
        <textarea
          value={grid}
          onChange={(e) => setGrid(e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder={"College Football\t\t\tNFL\n1\tGeorgia\t2-0\tSan Francisco 49ers\t1-0"}
          style={area}
        />
      </label>

      <label style={{ ...label, display: "block", marginTop: 10 }}>
        Write-up
        <textarea
          value={writeUp}
          onChange={(e) => setWriteUp(e.target.value)}
          rows={6}
          spellCheck={false}
          placeholder={"NFL\nSan Francisco 49ers - Kyle Shanahan is still Kyle Shanahan…"}
          style={area}
        />
      </label>

      {grid || writeUp ? (
        <div
          data-preview="report"
          style={{
            marginTop: 12,
            padding: "10px 12px",
            borderRadius: "var(--radius-sm)",
            border: "1px solid rgb(var(--accent-rgb) / .2)",
            background: "rgb(var(--sunken-rgb) / .5)",
          }}
        >
          <div style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
            {summarise(parsed.rankings, parsed.unmatched)}
          </div>

          {/* The two ways a paste goes wrong, both said out loud. A line
              nobody could read is a team missing from the board; a write-up
              that matched nobody is a paragraph nobody will see. */}
          {parsed.unmatched.length ? (
            <div style={{ ...trouble, marginTop: 8 }}>
              {`No team on the board is called: ${parsed.unmatched.join(", ")}. ` +
                "Check the spelling against the sheet."}
            </div>
          ) : null}

          {parsed.rankings.ignored.length ? (
            <div style={{ ...trouble, marginTop: 8 }}>
              {`Could not read: ${parsed.rankings.ignored.slice(0, 3).join(" · ")}` +
                (parsed.rankings.ignored.length > 3
                  ? ` and ${parsed.rankings.ignored.length - 3} more`
                  : "")}
            </div>
          ) : null}

          <Preview label="College" board={parsed.college} />
          <Preview label="NFL" board={parsed.nfl} />
        </div>
      ) : null}

      {error ? <div style={{ ...trouble, marginTop: 10 }}>{error}</div> : null}
      {notice ? (
        <div style={{ marginTop: 10, fontSize: 12, color: "var(--good)" }}>{notice}</div>
      ) : null}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
        <button onClick={() => void publish()} disabled={busy || !anything} style={action(!busy && anything)}>
          {`Publish week ${forWeek || "—"}`}
        </button>
        <button onClick={() => void publish(true)} disabled={busy} style={quiet}>
          Take it down
        </button>
      </div>
    </div>
  );
}

/** What one board would look like: the ranks, and how many carry a write-up. */
function Preview({ label, board }: { label: string; board: BoardReport }) {
  if (!board.ranked.length && !board.honorable.length) return null;

  const withNotes = board.ranked.filter((e) => e.note).length;

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--text-dim)" }}>
        {`${label.toUpperCase()} · ${withNotes} of ${board.ranked.length} WITH A WRITE-UP`}
      </div>
      <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 5, lineHeight: 1.6 }}>
        {board.ranked.map((e) => `${e.rank}. ${e.team}`).join("  ")}
      </div>
      {board.honorable.length ? (
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 4 }}>
          {`HM: ${board.honorable.map((e) => e.team).join(", ")}`}
        </div>
      ) : null}
    </div>
  );
}

const card: React.CSSProperties = {
  border: "1px solid rgb(var(--accent-rgb) / .22)",
  borderRadius: "var(--radius-lg)",
  background: "rgb(var(--surface-rgb) / .55)",
  padding: "16px 18px",
  marginBottom: 16,
};

const label: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: ".14em",
  color: "var(--text-dim)",
  display: "flex",
  alignItems: "center",
  gap: 10,
};

const numberField: React.CSSProperties = {
  width: 78,
  padding: "8px 10px",
  background: "rgb(var(--sunken-rgb) / .8)",
  border: "1px solid rgb(var(--accent-rgb) / .3)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text)",
  font: "inherit",
};

const area: React.CSSProperties = {
  display: "block",
  width: "100%",
  boxSizing: "border-box",
  marginTop: 6,
  padding: "10px 12px",
  background: "rgb(var(--sunken-rgb) / .8)",
  border: "1px solid rgb(var(--accent-rgb) / .3)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text)",
  fontFamily: "var(--font-body)",
  fontSize: 12.5,
  lineHeight: 1.5,
  resize: "vertical",
};

const trouble: React.CSSProperties = {
  fontSize: 11.5,
  lineHeight: 1.55,
  color: "var(--warn)",
};

function action(on: boolean): React.CSSProperties {
  return {
    cursor: on ? "pointer" : "default",
    fontSize: 11,
    letterSpacing: ".16em",
    padding: "11px 16px",
    borderRadius: "var(--radius-sm)",
    border: "1px solid rgb(var(--accent-bright-rgb) / .6)",
    background: on ? "rgb(var(--accent-rgb) / .2)" : "rgb(var(--accent-rgb) / .08)",
    color: on ? "var(--accent-text)" : "var(--text-off)",
  };
}

const quiet: React.CSSProperties = {
  cursor: "pointer",
  fontSize: 11,
  letterSpacing: ".16em",
  padding: "11px 16px",
  borderRadius: "var(--radius-sm)",
  border: "1px solid rgb(var(--accent-rgb) / .3)",
  background: "transparent",
  color: "var(--text-dim)",
};
