"use client";

import { useEffect, useMemo, useState } from "react";
import { parsePolls, nflMeta, NFL_TEAMS, RANKED, type BoardReport, type Entry } from "@/lib/pylon-report";
import { useReportLogos } from "@/lib/use-report-logos";
import ReportLogoSlot from "./ReportLogoSlot";
import { DragHandleProps, GripHandle, SortableList } from "./SortableList";
import { logo as clubLogo } from "@/data/league-data";

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
  const [newAbbr, setNewAbbr] = useState("");
  const [newConference, setNewConference] = useState("");
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
  const logos = useReportLogos();

  const anything = college.length > 0 || nfl.length > 0;

  function setField(board: "college" | "nfl", key: string, field: "record" | "lastResult", value: string) {
    const setter = board === "college" ? setCollege : setNfl;
    setter((list) => list.map((e) => (keyFor(e) === key ? { ...e, [field]: value } : e)));
  }

  function removeRow(board: "college" | "nfl", key: string) {
    const setter = board === "college" ? setCollege : setNfl;
    setter((list) => reranked(list.filter((e) => keyFor(e) !== key)));
  }

  function addTeam() {
    const team = newTeam.trim();
    const abbr = newAbbr.trim().toUpperCase();
    if (!team || !abbr || college.length >= RANKED.college) return;
    setCollege((list) => [
      ...list,
      { rank: list.length + 1, team, abbr, conference: newConference.trim(), record: "", lastResult: "" },
    ]);
    setNewTeam("");
    setNewAbbr("");
    setNewConference("");
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
            : `Week ${forWeek} is up. Everybody sees it under Rankings → Pylon Report.`,
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
        Re-rank a team by typing its new rank, by ▲ and ▼, or by dragging the
        grip; type into a record to update it. College can have a team added
        or dropped; the NFL already has all thirty-two, with their logos — tap
        a logo to replace it. Nothing changes for anybody else until you publish.
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
        scope="cfb"
        logos={logos.cfb}
        list={college}
        onReorder={setCollege}
        onFieldChange={(key, field, value) => setField("college", key, field, value)}
        onRemove={(key) => removeRow("college", key)}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
        <input
          value={newTeam}
          onChange={(e) => setNewTeam(e.target.value)}
          disabled={college.length >= RANKED.college}
          placeholder={college.length >= RANKED.college ? "Top 25 is full — drop one first" : "Team"}
          style={{ ...numberField, width: "auto", flex: "2 1 160px" }}
        />
        <input
          value={newAbbr}
          onChange={(e) => setNewAbbr(e.target.value)}
          disabled={college.length >= RANKED.college}
          placeholder="Abbr"
          style={{ ...numberField, width: "auto", flex: "0 1 70px" }}
        />
        <input
          value={newConference}
          onChange={(e) => setNewConference(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addTeam();
            }
          }}
          disabled={college.length >= RANKED.college}
          placeholder="Conference"
          style={{ ...numberField, width: "auto", flex: "1 1 110px" }}
        />
        <button
          onClick={addTeam}
          disabled={!newTeam.trim() || !newAbbr.trim() || college.length >= RANKED.college}
          style={action(!!newTeam.trim() && !!newAbbr.trim() && college.length < RANKED.college)}
        >
          Add
        </button>
      </div>

      <div style={{ marginTop: 18 }}>
        <BoardEditor
          title={`NFL (${nfl.length})`}
          scope="nfl"
          logos={logos.nfl}
          list={nfl}
          onReorder={setNfl}
          onFieldChange={(key, field, value) => setField("nfl", key, field, value)}
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
  return NFL_TEAMS.map((team, i) => {
    const { abbr } = nflMeta(team);
    return { rank: i + 1, team, abbr, conference: "", record: "", lastResult: "" };
  });
}

function BoardEditor({
  title,
  scope,
  logos,
  list,
  onReorder,
  onFieldChange,
  onRemove,
}: {
  title: string;
  scope: "cfb" | "nfl";
  logos: Record<string, string>;
  list: Entry[];
  onReorder: (next: Entry[]) => void;
  onFieldChange: (key: string, field: "record" | "lastResult", value: string) => void;
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
            renderRow={(raw, i, handle) => {
              // An NFL row from an older report may carry no abbreviation; the
              // club's own is known from its name.
              const entry = scope === "nfl" && !raw.abbr ? { ...raw, abbr: nflMeta(raw.team).abbr } : raw;
              return (
                <Row
                  entry={entry}
                  index={i}
                  count={list.length}
                  handle={handle}
                  scope={scope}
                  logo={logos[entry.abbr]}
                  // The NFL's thirty-two ship with the app; a school's is uploaded.
                  fallback={scope === "nfl" ? clubLogo(entry.abbr) : undefined}
                  onFieldChange={(field, value) => onFieldChange(keyFor(raw), field, value)}
                  onRemove={() => onRemove(keyFor(raw))}
                  onMove={(to) => onReorder(reranked(moveTo(list, i, to)))}
                />
              );
            }}
          />
        </div>
      )}
    </div>
  );
}

/** The list with the entry at `from` moved to position `to` (both 0-based). */
function moveTo(list: Entry[], from: number, to: number): Entry[] {
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, moved);
  return next;
}

/**
 * One team on a board. Two lines, so the name has the row's whole width on a
 * phone: the rank, crest and team on top; the record, last result and the
 * nudges under it. The rank is typed to move a team straight to a place —
 * dragging the 30th team to the top of a thirty-two-team list is not a thing
 * a thumb can do — and ▲/▼ move it one place; the grip still drags.
 */
function Row({
  entry,
  index,
  count,
  handle,
  scope,
  logo,
  fallback,
  onFieldChange,
  onRemove,
  onMove,
}: {
  entry: Entry;
  index: number;
  count: number;
  handle: DragHandleProps;
  scope: "cfb" | "nfl";
  logo: string | undefined;
  fallback?: string;
  onFieldChange: (field: "record" | "lastResult", value: string) => void;
  onRemove: () => void;
  onMove: (to: number) => void;
}) {
  const [rank, setRank] = useState(String(entry.rank));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- follow a move made elsewhere
    setRank(String(entry.rank));
  }, [entry.rank]);
  const commit = () => {
    const n = Math.round(Number(rank));
    if (!Number.isFinite(n) || n < 1) return setRank(String(entry.rank));
    const to = Math.min(n, count) - 1;
    if (to !== index) onMove(to);
    else setRank(String(entry.rank));
  };
  const field: React.CSSProperties = {
    padding: "6px 8px",
    minHeight: 32,
    boxSizing: "border-box",
    background: "rgb(var(--raised-rgb) / .7)",
    border: "1px solid rgb(var(--accent-rgb) / .25)",
    borderRadius: 6,
    color: "var(--text)",
    fontSize: 12,
  };
  const nudge: React.CSSProperties = {
    flex: "0 0 auto",
    width: 32,
    height: 32,
    cursor: "pointer",
    borderRadius: 6,
    border: "1px solid rgb(var(--accent-rgb) / .25)",
    background: "transparent",
    color: "var(--accent-text)",
    fontSize: 11,
  };

  return (
    <div
      data-report-row={entry.team}
      style={{
        padding: "8px 10px",
        borderTop: index === 0 ? undefined : "1px solid rgb(var(--accent-rgb) / .12)",
        background: "rgb(var(--sunken-rgb) / .5)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <GripHandle {...handle} />
        <input
          value={rank}
          onChange={(e) => setRank(e.target.value.replace(/\D/g, "").slice(0, 2))}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          inputMode="numeric"
          aria-label={`${entry.team}'s rank`}
          style={{
            ...field,
            width: 40,
            flex: "0 0 auto",
            textAlign: "center",
            fontFamily: "var(--font-heading)",
            fontVariantNumeric: "tabular-nums",
          }}
        />
        <ReportLogoSlot scope={scope} abbr={entry.abbr} image={logo} fallback={fallback} />
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 13,
            fontWeight: 500,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {entry.team}
          <span style={{ color: "var(--text-dim)", fontWeight: 400 }}>{` · ${entry.abbr}`}</span>
        </span>
        <button
          onClick={onRemove}
          aria-label={`Remove ${entry.team}`}
          style={{ ...nudge, border: 0, color: "var(--bad-text)", fontSize: 16 }}
        >
          ×
        </button>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6, paddingLeft: 40 }}>
        <input
          value={entry.record}
          onChange={(e) => onFieldChange("record", e.target.value)}
          placeholder="0-0"
          aria-label={`${entry.team}'s record`}
          style={{ ...field, width: 56, flex: "0 0 auto", textAlign: "center" }}
        />
        <input
          value={entry.lastResult}
          onChange={(e) => onFieldChange("lastResult", e.target.value)}
          placeholder="Last result"
          aria-label={`${entry.team}'s last result`}
          style={{ ...field, flex: 1, minWidth: 0 }}
        />
        <button
          onClick={() => onMove(index - 1)}
          disabled={index === 0}
          aria-label={`Move ${entry.team} up`}
          style={{ ...nudge, opacity: index === 0 ? 0.4 : 1 }}
        >
          ▲
        </button>
        <button
          onClick={() => onMove(index + 1)}
          disabled={index === count - 1}
          aria-label={`Move ${entry.team} down`}
          style={{ ...nudge, opacity: index === count - 1 ? 0.4 : 1 }}
        >
          ▼
        </button>
      </div>
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
