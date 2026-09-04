"use client";

import { useState } from "react";

/**
 * Closing the book on a season and opening the next.
 *
 * Behind a typed confirmation, like the other irreversible things in the
 * office. It keeps every roster — that is the whole of what makes this a
 * dynasty rather than a new league every August — but it does take the
 * schedule, the results and the bracket, and there is no undo.
 */
export default function NextSeason({
  season,
  champion,
  busy,
  onRoll,
}: {
  season: number;
  /** The franchise that won this season, or null while it is still being played. */
  champion: string | null;
  busy: boolean;
  onRoll: () => void;
}) {
  const [typed, setTyped] = useState("");
  const next = season + 1;
  const armed = typed.trim() === String(next);

  return (
    <div>
      <h6 style={{ margin: "0 0 4px", color: "#d2cefd" }}>Start the {next} season</h6>

      {champion ? (
        <p style={{ fontSize: 11.5, color: "#9397ab", margin: "0 0 12px", lineHeight: 1.6 }}>
          <strong style={{ color: "#e0b573", fontWeight: 500 }}>{champion}</strong> won {season}.
          Rolling forward keeps every roster exactly as it stands and clears the season around
          them: the schedule and every result, the bracket, live claims, the trade block and
          everyone&apos;s queues. The {next} draft opens with the picks people have already been
          trading for. The rosters are photographed first, and the title stays on the record.
        </p>
      ) : (
        <p style={{ fontSize: 11.5, color: "#9397ab", margin: "0 0 12px", lineHeight: 1.6 }}>
          The {season} season has no champion yet, so there is nothing to roll forward. This
          unlocks once the postseason has been played out — a rollover in the middle of a season
          is not a rollover, it is a reset that lies about what it did.
        </p>
      )}

      {champion ? (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <div>
            <label
              htmlFor="rollConfirm"
              style={{
                display: "block",
                fontSize: 10,
                letterSpacing: ".18em",
                color: "#75798c",
                marginBottom: 5,
              }}
            >
              TYPE {next} TO CONFIRM
            </label>
            <input
              id="rollConfirm"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              inputMode="numeric"
              style={{
                width: 110,
                padding: "7px 9px",
                background: "rgba(20,22,35,.8)",
                border: "1px solid rgba(145,132,217,.28)",
                borderRadius: "var(--radius-sm)",
                color: "#e9e9ed",
                font: "inherit",
                fontSize: 13,
              }}
            />
          </div>

          <button
            onClick={() => {
              onRoll();
              setTyped("");
            }}
            disabled={busy || !armed}
            style={{
              padding: "8px 16px",
              fontSize: 10,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              border: `1px solid ${armed && !busy ? "rgba(224,181,115,.6)" : "rgba(145,132,217,.2)"}`,
              background: "transparent",
              color: armed && !busy ? "#e0b573" : "#5a5d6e",
              borderRadius: "var(--radius-sm)",
              fontFamily: "inherit",
              cursor: armed && !busy ? "pointer" : "default",
            }}
          >
            Roll into {next}
          </button>
        </div>
      ) : null}
    </div>
  );
}
