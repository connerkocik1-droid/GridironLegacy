"use client";

import { useState } from "react";

const label: React.CSSProperties = {
  display: "block",
  fontSize: 10,
  letterSpacing: ".18em",
  color: "var(--text-dim)",
  marginBottom: 5,
};

const field: React.CSSProperties = {
  width: 90,
  padding: "7px 9px",
  background: "rgb(var(--sunken-rgb) / .8)",
  border: "1px solid rgb(var(--accent-rgb) / .28)",
  borderRadius: "var(--radius-sm)",
  color: "var(--text)",
  font: "inherit",
  fontSize: 13,
};

/**
 * The two rules the season is played under that nothing could change.
 *
 * Both are read by the database on every move — the deadline on every trade,
 * the waiver period on every drop — and until this card existed the only way
 * to set either was a SQL console. They are the commissioner's decisions, so
 * they belong where the commissioner is.
 */
export default function SeasonRules({
  tradeDeadlineWeek,
  waiverDays,
  regularWeeks,
  busy,
  onSave,
}: {
  tradeDeadlineWeek: number;
  waiverDays: number;
  regularWeeks: number;
  busy: boolean;
  onSave: (changes: { tradeDeadlineWeek?: number; waiverDays?: number }) => void;
}) {
  const [deadline, setDeadline] = useState(String(tradeDeadlineWeek));
  const [days, setDays] = useState(String(waiverDays));

  const deadlineNum = Number(deadline);
  const daysNum = Number(days);
  const valid =
    Number.isInteger(deadlineNum) &&
    deadlineNum >= 0 &&
    deadlineNum <= 25 &&
    Number.isInteger(daysNum) &&
    daysNum >= 1 &&
    daysNum <= 14;
  const changed = deadlineNum !== tradeDeadlineWeek || daysNum !== waiverDays;

  return (
    <div>
      <h6 style={{ margin: "0 0 4px", color: "var(--accent-text)" }}>Season rules</h6>
      <p style={{ fontSize: 11.5, color: "var(--text-muted)", margin: "0 0 12px", lineHeight: 1.6 }}>
        When trading stops, and how long a dropped player sits on waivers before the run releases
        him. Both take effect on the next move anybody makes.
      </p>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
        <div>
          <label htmlFor="tradeDeadlineWeek" style={label}>
            TRADE DEADLINE (WEEK)
          </label>
          <input
            id="tradeDeadlineWeek"
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            inputMode="numeric"
            style={field}
          />
        </div>

        <div>
          <label htmlFor="waiverDays" style={label}>
            WAIVER PERIOD (DAYS)
          </label>
          <input
            id="waiverDays"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            inputMode="numeric"
            style={field}
          />
        </div>

        <button
          onClick={() => onSave({ tradeDeadlineWeek: deadlineNum, waiverDays: daysNum })}
          disabled={busy || !valid || !changed}
          style={{
            padding: "8px 16px",
            fontSize: 10,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            border: `1px solid ${valid && changed && !busy ? "rgb(var(--accent-bright-rgb) / .6)" : "rgb(var(--accent-rgb) / .2)"}`,
            background: "transparent",
            color: valid && changed && !busy ? "var(--accent-text)" : "var(--text-faint)",
            borderRadius: "var(--radius-sm)",
            fontFamily: "inherit",
            cursor: valid && changed && !busy ? "pointer" : "default",
          }}
        >
          Save
        </button>
      </div>

      <p style={{ fontSize: 11, color: "var(--text-dim)", margin: "12px 0 0", lineHeight: 1.6 }}>
        {deadlineNum === 0
          ? "Trades never stop — a franchise out of contention can hand its season to a friend in week seventeen."
          : `Trades stop after week ${deadlineNum} of a ${regularWeeks}-week regular season.`}{" "}
        A dropped player is claimable for {daysNum === 1 ? "a day" : `${daysNum} days`}, then the
        next nightly run settles the claims and lets him go.
      </p>
    </div>
  );
}
