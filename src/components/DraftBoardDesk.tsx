"use client";

import { useEffect, useState } from "react";
import { BIG_BOARD_RANKED, parseBigBoard, type ProspectBoard, type ProspectEntry } from "@/lib/pylon-draft-board";
import { DragHandleProps, GripHandle, SortableList } from "./SortableList";

/**
 * Where the 2027 big board is maintained.
 *
 * Carries forward the same way ReportDesk's boards do — load what was last
 * published, drag to reorder, add a prospect or drop one — with one
 * exception: there is no prior week the very first time this runs, so a
 * one-time paste seeds the first fifty. Once something has been published,
 * the paste box is gone for good; the list from here on is the board.
 */
export default function DraftBoardDesk({
  week,
  onPublished,
}: {
  week: number | null;
  onPublished?: () => void;
}) {
  const [forWeek, setForWeek] = useState<string>(week == null ? "1" : String(week));
  const [list, setList] = useState<ProspectEntry[]>([]);
  const [everPublished, setEverPublished] = useState(false);
  const [seedGrid, setSeedGrid] = useState("");
  const [newPlayer, setNewPlayer] = useState("");
  const [newPosition, setNewPosition] = useState("");
  const [newCollege, setNewCollege] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const res = await fetch("/api/draft-board", { cache: "no-store" });
        const body = res.ok ? await res.json().catch(() => ({})) : {};
        if (!live) return;
        const board = body.board as ProspectBoard | null;
        if (board?.ranked?.length) {
          setList(board.ranked);
          setEverPublished(true);
        }
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const seeded = parseBigBoard(seedGrid);
  const anything = list.length > 0;

  function seedFromPaste() {
    if (!seeded.board.ranked.length) return;
    setList(seeded.board.ranked);
    setSeedGrid("");
  }

  function removeRow(key: string) {
    setList((prev) => reranked(prev.filter((e) => keyFor(e) !== key)));
  }

  function addProspect() {
    const player = newPlayer.trim();
    if (!player || list.length >= BIG_BOARD_RANKED) return;
    setList((prev) => [
      ...prev,
      {
        rank: prev.length + 1,
        player,
        position: newPosition.trim().toUpperCase().slice(0, 6),
        college: newCollege.trim(),
      },
    ]);
    setNewPlayer("");
    setNewPosition("");
    setNewCollege("");
  }

  async function publish(remove = false) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/draft-board", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          remove
            ? { week: Number(forWeek), remove: true }
            : { week: Number(forWeek), board: { ranked: reranked(list), honorable: [] } },
        ),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setError(body.error ?? "That did not publish.");
      else {
        setNotice(
          remove
            ? `Week ${forWeek}'s big board is down.`
            : `Week ${forWeek}'s big board is up, on the Pylon Report page.`,
        );
        if (!remove) setEverPublished(true);
        onPublished?.();
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div id="office-draft-board" style={card}>
        <h6 style={{ margin: "0 0 4px", color: "var(--accent-text)" }}>2027 Big Board</h6>
        <div style={{ fontSize: 12, color: "var(--text-dim)" }}>Loading…</div>
      </div>
    );
  }

  return (
    <div id="office-draft-board" style={card}>
      <h6 style={{ margin: "0 0 4px", color: "var(--accent-text)" }}>2027 Big Board</h6>

      {!everPublished && list.length === 0 ? (
        <>
          <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 12px" }}>
            Nothing published yet — paste the first fifty in once to start the
            board, then drag, add and drop from here on. One prospect per
            row: a rank, a player, a position and a college.
          </p>
          <label style={{ ...label, display: "block" }}>
            Seed the board
            <textarea
              value={seedGrid}
              onChange={(e) => setSeedGrid(e.target.value)}
              rows={6}
              spellCheck={false}
              placeholder={"1\tJane Doe\tQB\tOhio State\n2\tJohn Roe\tEDGE\tGeorgia"}
              style={area}
            />
          </label>
          {seeded.ignored.length ? (
            <div style={{ ...trouble, marginTop: 8 }}>
              {`Could not read: ${seeded.ignored.slice(0, 3).join(" · ")}` +
                (seeded.ignored.length > 3 ? ` and ${seeded.ignored.length - 3} more` : "")}
            </div>
          ) : null}
          <button
            onClick={seedFromPaste}
            disabled={!seeded.board.ranked.length}
            style={{ ...action(!!seeded.board.ranked.length), marginTop: 10 }}
          >
            {`Load ${seeded.board.ranked.length || ""} prospect${seeded.board.ranked.length === 1 ? "" : "s"}`}
          </button>
        </>
      ) : (
        <>
          <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6, margin: "0 0 12px" }}>
            Drag a row to reorder it. Top fifty is the board.
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

          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 10, letterSpacing: ".2em", color: "var(--text-dim)", margin: "0 0 6px" }}>
              {`PYLON 50 (${list.length})`}
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
                  onReorder={(next) => setList(reranked(next))}
                  renderRow={(entry, i, handle) => (
                    <Row entry={entry} index={i} handle={handle} onRemove={() => removeRow(keyFor(entry))} />
                  )}
                />
              </div>
            )}
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
            <input
              value={newPlayer}
              onChange={(e) => setNewPlayer(e.target.value)}
              disabled={list.length >= BIG_BOARD_RANKED}
              placeholder={list.length >= BIG_BOARD_RANKED ? "Top 50 is full — drop one first" : "Player"}
              style={{ ...numberField, width: "auto", flex: "2 1 160px" }}
            />
            <input
              value={newPosition}
              onChange={(e) => setNewPosition(e.target.value)}
              disabled={list.length >= BIG_BOARD_RANKED}
              placeholder="Pos"
              style={{ ...numberField, width: "auto", flex: "0 1 60px" }}
            />
            <input
              value={newCollege}
              onChange={(e) => setNewCollege(e.target.value)}
              disabled={list.length >= BIG_BOARD_RANKED}
              placeholder="College"
              style={{ ...numberField, width: "auto", flex: "1 1 120px" }}
            />
            <button
              onClick={addProspect}
              disabled={!newPlayer.trim() || list.length >= BIG_BOARD_RANKED}
              style={action(!!newPlayer.trim() && list.length < BIG_BOARD_RANKED)}
            >
              Add
            </button>
          </div>

          {error ? <div style={{ ...trouble, marginTop: 10 }}>{error}</div> : null}
          {notice ? <div style={{ marginTop: 10, fontSize: 12, color: "var(--good)" }}>{notice}</div> : null}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14 }}>
            <button onClick={() => void publish()} disabled={busy || !anything} style={action(!busy && anything)}>
              {`Publish week ${forWeek || "—"}`}
            </button>
            <button onClick={() => void publish(true)} disabled={busy} style={quiet}>
              Take it down
            </button>
          </div>
        </>
      )}
    </div>
  );
}

const keyFor = (e: ProspectEntry) => `${e.player}-${e.rank}`;

/** Renumber a list 1..n after a reorder, an add, or a remove. */
function reranked(list: ProspectEntry[]): ProspectEntry[] {
  return list.map((e, i) => ({ ...e, rank: i + 1 }));
}

function Row({
  entry,
  index,
  handle,
  onRemove,
}: {
  entry: ProspectEntry;
  index: number;
  handle: DragHandleProps;
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
        {entry.player}
        {entry.position ? (
          <span style={{ color: "var(--text-dim)" }}>{` · ${entry.position}`}</span>
        ) : null}
        {entry.college ? (
          <span style={{ color: "var(--text-faint)" }}>{` · ${entry.college}`}</span>
        ) : null}
      </span>
      <button
        onClick={onRemove}
        aria-label={`Remove ${entry.player}`}
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
