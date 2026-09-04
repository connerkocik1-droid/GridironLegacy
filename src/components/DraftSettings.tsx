"use client";

import { useState } from "react";
import {
  DEFAULT_PICK_CLOCK,
  MAX_SECONDS,
  MIN_SECONDS,
  tierRounds,
  type ClockTier,
} from "@/lib/draft-clock";

/**
 * The settings that decide how draft night runs, before it does.
 *
 * The pick clock and the cinematic rounds have been read by the draft room
 * since it was built and written by nothing — they were whatever the seed left
 * behind, and changing either meant a SQL console. The order was the same
 * story: the board has always been drawn from it, and there was no way to
 * decide it.
 *
 * The clock is a ladder rather than a number, because ninety seconds is right
 * for the first round and absurd for the fourteenth. Each rung says which
 * round it runs through; the last one has no end, because a draft that runs
 * past every stated round still has to have a clock.
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
  pickClock,
  cinematicRounds,
  order,
  managers,
  canChange,
  busy,
  onSave,
  onOrder,
}: {
  pickClock: ClockTier[];
  cinematicRounds: number;
  /** The slots in pick order, or null while it is still plain slot order. */
  order: string[] | null;
  managers: Manager[];
  /** False once the draft has started: the board cannot be renumbered. */
  canChange: boolean;
  busy: boolean;
  onSave: (changes: { pickClock?: ClockTier[]; cinematicRounds?: number }) => void;
  onOrder: (slots: string[]) => void;
}) {
  // Held as text so a half-typed number is not read as a clock. What is on
  // screen is what the commissioner is typing; what is saved is what parses.
  const [tiers, setTiers] = useState(() =>
    (pickClock.length ? pickClock : DEFAULT_PICK_CLOCK).map((t) => ({
      through: t.throughRound == null ? "" : String(t.throughRound),
      seconds: String(t.seconds),
    })),
  );
  const [cinematic, setCinematic] = useState(String(cinematicRounds));

  const bySlot = new Map(managers.map((m) => [m.slot, m]));
  const current = (order?.length ? order : managers.map((m) => m.slot)).filter((s) => bySlot.has(s));

  /**
   * The tiers as numbers, with the rules the database will apply anyway.
   *
   * The last tier is always open-ended — a draft that runs past the final
   * stated round must still have a clock — and each round has to be later
   * than the one before it, or a tier further down would cover ground an
   * earlier one already claimed and never be reached.
   */
  function parseTiers(): ClockTier[] | null {
    const out: ClockTier[] = [];
    let previous = 0;

    for (const [i, row] of tiers.entries()) {
      const last = i === tiers.length - 1;
      const seconds = Number(row.seconds);
      if (!Number.isInteger(seconds) || seconds < MIN_SECONDS || seconds > MAX_SECONDS) return null;

      if (last) {
        out.push({ throughRound: null, seconds });
        continue;
      }

      const through = Number(row.through);
      if (!Number.isInteger(through) || through <= previous || through > 40) return null;
      previous = through;
      out.push({ throughRound: through, seconds });
    }

    return out.length ? out : null;
  }

  const parsed = parseTiers();
  const clockChanged =
    parsed != null && JSON.stringify(parsed) !== JSON.stringify(pickClock);
  const changed = clockChanged || Number(cinematic) !== cinematicRounds;

  function setTier(index: number, part: "through" | "seconds", value: string) {
    setTiers((was) =>
      was.map((row, i) => (i === index ? { ...row, [part]: value } : row)),
    );
  }

  function addTier() {
    // The new rung goes above the open-ended one, because that one is the end
    // by definition and nothing can sit after it.
    setTiers((was) => {
      const last = was[was.length - 1];
      const previous = was.length > 1 ? Number(was[was.length - 2].through) || 0 : 0;
      return [
        ...was.slice(0, -1),
        { through: String(previous + 4), seconds: last.seconds },
        last,
      ];
    });
  }

  function removeTier(index: number) {
    // Never the last one: a clock with no tiers is a draft with no clock.
    setTiers((was) => (was.length > 1 ? was.filter((_, i) => i !== index) : was));
  }

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

      <div style={{ ...label, marginBottom: 8 }}>THE PICK CLOCK</div>

      <div style={{ marginBottom: 12 }}>
        {tiers.map((row, i) => {
          const last = i === tiers.length - 1;
          return (
            <div
              key={i}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 0",
                borderTop: "1px solid rgba(145,132,217,.12)",
                flexWrap: "wrap",
              }}
            >
              <span
                style={{
                  fontSize: 11.5,
                  color: "#9397ab",
                  minWidth: 108,
                  flex: "0 0 auto",
                }}
              >
                {parsed ? tierRounds(parsed, i) : last ? "And after" : `Tier ${i + 1}`}
              </span>

              {last ? (
                <span style={{ fontSize: 11, color: "#75798c", width: 92, flex: "0 0 auto" }}>
                  to the end
                </span>
              ) : (
                <label
                  style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}
                >
                  <span style={{ fontSize: 11, color: "#75798c" }}>through round</span>
                  <input
                    value={row.through}
                    onChange={(e) =>
                      setTier(i, "through", e.target.value.replace(/\D/g, "").slice(0, 2))
                    }
                    inputMode="numeric"
                    aria-label={`Tier ${i + 1} runs through round`}
                    style={{ ...field, width: 56 }}
                  />
                </label>
              )}

              <label
                style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}
              >
                <input
                  value={row.seconds}
                  onChange={(e) =>
                    setTier(i, "seconds", e.target.value.replace(/\D/g, "").slice(0, 3))
                  }
                  inputMode="numeric"
                  aria-label={`Tier ${i + 1} seconds a pick`}
                  style={{ ...field, width: 62 }}
                />
                <span style={{ fontSize: 11, color: "#75798c" }}>seconds</span>
              </label>

              {tiers.length > 1 ? (
                <button
                  onClick={() => removeTier(i)}
                  disabled={busy}
                  aria-label={`Remove tier ${i + 1}`}
                  style={{
                    ...action(!busy),
                    padding: "6px 10px",
                    fontSize: 11,
                    minHeight: 34,
                    marginLeft: "auto",
                  }}
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <div style={{ display: "flex", gap: 20, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 8 }}>
        <button onClick={addTier} disabled={busy || tiers.length >= 8} style={action(!busy && tiers.length < 8)}>
          Add a tier
        </button>

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
            onSave({
              ...(clockChanged && parsed ? { pickClock: parsed } : {}),
              cinematicRounds: Number(cinematic),
            })
          }
          disabled={busy || !changed}
          style={action(!busy && changed)}
        >
          Save
        </button>
      </div>

      {parsed == null ? (
        <p style={{ fontSize: 11.5, color: "#e0b573", lineHeight: 1.6, margin: "0 0 12px" }}>
          Each tier needs {MIN_SECONDS}–{MAX_SECONDS} seconds, and each one has to
          end on a later round than the one above it.
        </p>
      ) : null}

      <p style={{ fontSize: 11.5, color: "#75798c", lineHeight: 1.6, margin: "0 0 18px" }}>
        A pick left to run out is drafted for the manager from their queue, and
        from ADP and what their roster still needs when the queue is empty — so
        the clock is what keeps the night moving rather than a punishment. Past
        the cinematic rounds the board just updates: ten seconds a pick stops
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
