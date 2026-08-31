"use client";

import { useState } from "react";

/**
 * The settings that decide how draft night runs, before it does.
 *
 * The pick clock and the cinematic rounds have been read by the draft room
 * since it was built and written by nothing — they were whatever the seed left
 * behind, and changing either meant a SQL console. The order was the same
 * story: the board has always been drawn from it, and there was no way to
 * decide it.
 *
 * All three are fixed once the first pick is made, because the board is drawn
 * from them and renumbering it under picks that already exist is not a
 * setting, it is a different draft.
 */

interface Manager {
  id: string;
  slot: string;
  franchise: string;
}

const label: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  letterSpacing: ".2em",
  color: "#75798c",
  marginBottom: 6,
};

const field: React.CSSProperties = {
  width: 78,
  padding: "8px 10px",
  background: "rgba(20,22,35,.8)",
  border: "1px solid rgba(145,132,217,.3)",
  borderRadius: "var(--radius-sm)",
  color: "#e9e9ed",
  font: "inherit",
  fontSize: 14,
};

const action = (enabled: boolean): React.CSSProperties => ({
  padding: "8px 14px",
  border: "1px solid rgba(181,171,252,.6)",
  background: "transparent",
  color: "#d2cefd",
  borderRadius: "var(--radius-sm)",
  font: "inherit",
  fontSize: 12,
  letterSpacing: ".1em",
  textTransform: "uppercase",
  cursor: enabled ? "pointer" : "default",
  opacity: enabled ? 1 : 0.45,
});

export default function DraftSettings({
  pickSeconds,
  cinematicRounds,
  order,
  managers,
  canChange,
  busy,
  onSave,
  onOrder,
}: {
  pickSeconds: number;
  cinematicRounds: number;
  /** The slots in pick order, or null while it is still plain slot order. */
  order: string[] | null;
  managers: Manager[];
  /** False once the draft has started: the board cannot be renumbered. */
  canChange: boolean;
  busy: boolean;
  onSave: (changes: { pickSeconds?: number; cinematicRounds?: number }) => void;
  onOrder: (slots: string[]) => void;
}) {
  const [clock, setClock] = useState(String(pickSeconds));
  const [cinematic, setCinematic] = useState(String(cinematicRounds));

  const bySlot = new Map(managers.map((m) => [m.slot, m]));
  const current = (order?.length ? order : managers.map((m) => m.slot)).filter((s) => bySlot.has(s));

  const changed =
    Number(clock) !== pickSeconds || Number(cinematic) !== cinematicRounds;

  function shuffle() {
    const slots = managers.map((m) => m.slot);
    // Fisher–Yates, so every order is as likely as every other. Sorting by a
    // random comparator is the usual shortcut and it is biased.
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    onOrder(slots);
  }

  function move(index: number, by: number) {
    const slots = [...current];
    const to = index + by;
    if (to < 0 || to >= slots.length) return;
    [slots[index], slots[to]] = [slots[to], slots[index]];
    onOrder(slots);
  }

  return (
    <>
      <h6 style={{ margin: "0 0 4px", color: "#d2cefd" }}>Draft settings</h6>
      <p style={{ fontSize: 12, color: "#9397ab", lineHeight: 1.6, margin: "0 0 14px" }}>
        How long each pick has, how many rounds get the full-screen reveal, and
        who picks when. All three are fixed once the first pick is made — the
        board is drawn from them, and renumbering it under picks that already
        exist is not a setting, it is a different draft.
      </p>

      <div style={{ display: "flex", gap: 20, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 8 }}>
        <div>
          <label htmlFor="pickSeconds" style={label}>
            SECONDS A PICK
          </label>
          <input
            id="pickSeconds"
            value={clock}
            onChange={(e) => setClock(e.target.value.replace(/\D/g, "").slice(0, 3))}
            inputMode="numeric"
            style={field}
          />
        </div>

        <div>
          <label htmlFor="cinematicRounds" style={label}>
            CINEMATIC ROUNDS
          </label>
          <input
            id="cinematicRounds"
            value={cinematic}
            onChange={(e) => setCinematic(e.target.value.replace(/\D/g, "").slice(0, 2))}
            inputMode="numeric"
            style={field}
          />
        </div>

        <button
          onClick={() =>
            onSave({ pickSeconds: Number(clock), cinematicRounds: Number(cinematic) })
          }
          disabled={busy || !changed}
          style={action(!busy && changed)}
        >
          Save
        </button>
      </div>

      <p style={{ fontSize: 11.5, color: "#75798c", lineHeight: 1.6, margin: "0 0 18px" }}>
        A pick left to run out is drafted for the manager from their queue, so
        the clock is what keeps the night moving rather than a punishment. Past
        the cinematic rounds the board just updates — ten seconds a pick stops
        being a thrill by round four.
      </p>

      <div style={{ fontSize: 10, letterSpacing: ".2em", color: "#75798c", marginBottom: 8 }}>
        PICK ORDER
      </div>

      {canChange ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button onClick={shuffle} disabled={busy} style={action(!busy)}>
            Draw it at random
          </button>
          <button
            onClick={() => onOrder([...current].reverse())}
            disabled={busy}
            style={action(!busy)}
          >
            Reverse
          </button>
          <button
            onClick={() => onOrder(managers.map((m) => m.slot))}
            disabled={busy}
            style={action(!busy)}
          >
            Back to slot order
          </button>
        </div>
      ) : (
        <p style={{ fontSize: 12, color: "#e0b573", lineHeight: 1.6, margin: "0 0 12px" }}>
          The draft has started, so the order is fixed. Resetting the draft
          opens it again.
        </p>
      )}

      <div>
        {current.map((slot, i) => (
          <div
            key={slot}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "7px 0",
              borderTop: "1px solid rgba(145,132,217,.12)",
            }}
          >
            <span
              style={{
                fontSize: 11,
                color: "#75798c",
                width: 22,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {i + 1}
            </span>
            <span style={{ fontSize: 10, color: "#75798c", width: 44 }}>{slot}</span>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: 14, flex: 1, minWidth: 0 }}>
              {bySlot.get(slot)?.franchise ?? slot}
            </span>
            {canChange ? (
              <div style={{ display: "flex", gap: 3 }}>
                <button
                  onClick={() => move(i, -1)}
                  disabled={busy || i === 0}
                  aria-label={`Move ${bySlot.get(slot)?.franchise ?? slot} up`}
                  style={{ ...action(!busy && i > 0), padding: "3px 9px", fontSize: 11 }}
                >
                  ↑
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={busy || i === current.length - 1}
                  aria-label={`Move ${bySlot.get(slot)?.franchise ?? slot} down`}
                  style={{ ...action(!busy && i < current.length - 1), padding: "3px 9px", fontSize: 11 }}
                >
                  ↓
                </button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </>
  );
}
