"use client";

import { useEffect, useMemo, useState } from "react";
import { parsePolls, NFL_TEAMS, RANKED, type BoardReport, type Entry } from "@/lib/pylon-report";
import { DragHandleProps, GripHandle, SortableList } from "./SortableList";

/**
 * Where the week's Pylon Report is maintained.
 *
 * Not a paste any more. Each board is a list the commissioner reorders by
 * dragging, edits a record on, and adds a team to or drops one from — the
 * list he's editing already is the board, so there is nothing to parse and
 * nothing to preview before publishing. Publishing is just saving the order
 * on screen.
 *
 * The NFL starts with all thirty-two clubs the first time this loads, since
 * there is no "add a team" for a league that already has every one of them.
 * College starts from whatever was last published, or empty the very first
 * time — built up one add at a time.
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
  const [college, setCollege] = useState<Entry[]>([]);
  const [nfl, setNfl] = useState<Entry[]>([]);
  const [pollsGrid, setPollsGrid] = useState("");
  const [newTeam, setNewTeam] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/report", { cache: "no-store" });
        const body = res.ok ? await res.json().catch(() => ({})) : {};
        if (!live) return;
        const report = body.report as { college?: BoardReport; nfl?: BoardReport } | null;
        setCollege(report?.college?.ranked ?? []);
        setNfl(report?.nfl?.ranked?.length ? report.nfl.ranked : seedNfl());
      } catch {
        if (live) setNfl(seedNfl());
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const polls = useMemo(() => parsePolls(pollsGrid), [pollsGrid]);

  const anything = college.length > 0 || nfl.length > 0;

  function setRecord(board: "college" | "nfl", key: string, record: string) {
    const setter = board === "college" ? setCollege : setNfl;
    setter((list) => list.map((e) => (keyFor(e) === key ? { ...e, record } : e)));
  }

  function removeRow(board: "college" | "nfl", key: string) {
    const setter = board === "college" ? setCollege : setNfl;
    setter((list) => reranked(list.filter((e) => keyFor(e) !== key)));
  }

  function addTeam() {
    const team = newTeam.trim();
    if (!team || college.length >= RANKED.college) return;
    setCollege((list) => [...list, { rank: list.length + 1, team, record: "" }]);
    setNewTeam("");
  }

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
            : {
                week: Number(forWeek),
                college: { ranked: reranked(college), honorable: [], polls: polls.polls },
                nfl: { ranked: reranked(nfl), honorable: [] },
              },
        ),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "That did not publish.");
      else {
        setNotice(
          remove
            ? `Week ${forWeek} is down.`
            : `Week ${forWeek} is up. Everybody sees it on the home page and the Pylon Report page.`,
        );
        onPublished?.();
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div id="office-report" style={card}>
        <h6 style={{ margin: "0 0 4px", color: "var(--accent-text)" }}>The Pylon Report</h6>
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Loading last week&apos;s boards…</div>
      </div>
    );
  }

  return (
    <div id="office-report" style={card}>
      <h6 style={{ margin: "0 0 4px", color: "var(--accent-text)" }}>The Pylon Report</h6>
      <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 12px" }}>
        Drag a row to reorder it, type into a record to update it. College
        can have a team added or dropped; the NFL already has all thirty-two.
        Nothing changes for anybody else until you publish.
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

      <BoardEditor
        title={`College (${college.length})`}
        list={college}
        onReorder={setCollege}
        onRecordChange={(key, record) => setRecord("college", key, record)}
        onRemove={(key) => removeRow("college", key)}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <input
          value={newTeam}
          onChange={(e) => setNewTeam(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTeam();
            }
          }}
          disabled={college.length >= RANKED.college}
          placeholder={college.length >= RANKED.college ? "Top 25 is full — drop one first" : "Add a team…"}
          style={{ ...numberField, width: "auto", flex: 1 }}
        />
        <button
          onClick={addTeam}
          disabled={!newTeam.trim() || college.length >= RANKED.college}
          style={action(!!newTeam.trim() && college.length < RANKED.college)}
        >
          Add
        </button>
      </div>

      <div style={{ marginTop: 18 }}>
        <BoardEditor
          title={`NFL (${nfl.length})`}
          list={nfl}
          onReorder={setNfl}
          onRecordChange={(key, record) => setRecord("nfl", key, record)}
          onRemove={(key) => removeRow("nfl", key)}
        />
      </div>

      <label style={{ ...label, display: "block", marginTop: 16 }}>
        National polls (AP / Coaches / CFP, college only)
        <textarea
          value={pollsGrid}
          onChange={(e) => setPollsGrid(e.target.value)}
          rows={4}
          spellCheck={false}
          placeholder={"AP\tCoaches\tCFP\n1\tOhio State\tOhio State\tGeorgia"}
          style={area}
        />
      </label>
      {polls.ignored.length ? (
        <div style={{ ...trouble, marginTop: 6 }}>
          {`Could not read: ${polls.ignored.slice(0, 3).join(" · ")}` +
            (polls.ignored.length > 3 ? ` and ${polls.ignored.length - 3} more` : "")}
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

const keyFor = (e: Entry) => `${e.team}-${e.rank}`;

/** Renumber a list 1..n after a reorder, an add, or a remove. */
function reranked(list: Entry[]): Entry[] {
  return list.map((e, i) => ({ ...e, rank: i + 1 }));
}

function seedNfl(): Entry[] {
  return NFL_TEAMS.map((team, i) => ({ rank: i + 1, team, record: "" }));
}

function BoardEditor({
  title,
  list,
  onReorder,
  onRecordChange,
  onRemove,
}: {
  title: string;
  list: Entry[];
  onReorder: (next: Entry[]) => void;
  onRecordChange: (key: string, record: string) => void;
  onRemove: (key: string) => void;
}) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--text-dim)", margin: "12px 0 6px" }}>
        {title.toUpperCase()}
      </div>
      {list.length === 0 ? (
        <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Nothing yet.</div>
      ) : (
        <div
          style={{
            border: "1px solid rgb(var(--accent-rgb) / .2)",
            borderRadius: "var(--radius-sm)",
            overflow: "hidden",
          }}
        >
          <SortableList
            items={list}
            getId={keyFor}
            onReorder={(next) => onReorder(reranked(next))}
            renderRow={(entry, i, handle) => (
              <Row
                entry={entry}
                index={i}
                handle={handle}
                onRecordChange={(record) => onRecordChange(keyFor(entry), record)}
                onRemove={() => onRemove(keyFor(entry))}
              />
            )}
          />
        </div>
      )}
    </div>
  );
}

function Row({
  entry,
  index,
  handle,
  onRecordChange,
  onRemove,
}: {
  entry: Entry;
  index: number;
  handle: DragHandleProps;
  onRecordChange: (record: string) => void;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "8px 10px",
        borderTop: index === 0 ? undefined : "1px solid rgb(var(--accent-rgb) / .12)",
        background: "rgb(var(--sunken-rgb) / .5)",
      }}
    >
      <GripHandle {...handle} />
      <span
        style={{
          width: 22,
          flex: "0 0 auto",
          fontFamily: "var(--font-heading)",
          fontSize: 12,
          color: "var(--text-dim)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {entry.rank}
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis" }}>
        {entry.team}
      </span>
      <input
        value={entry.record}
        onChange={(e) => onRecordChange(e.target.value)}
        placeholder="0-0"
        style={{
          width: 48,
          flex: "0 0 auto",
          padding: "5px 6px",
          background: "rgb(var(--raised-rgb) / .7)",
          border: "1px solid rgb(var(--accent-rgb) / .25)",
          borderRadius: 6,
          color: "var(--text)",
          fontSize: 11.5,
          textAlign: "center",
        }}
      />
      <button
        onClick={onRemove}
        aria-label={`Remove ${entry.team}`}
        style={{
          flex: "0 0 auto",
          cursor: "pointer",
          border: 0,
          background: "transparent",
          color: "var(--bad-text)",
          fontSize: 15,
          padding: "2px 4px",
        }}
      >
        ×
      </button>
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
