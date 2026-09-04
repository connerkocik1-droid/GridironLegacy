"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The waiting room: what a manager sees before the draft opens.
 *
 * The clock is the server's, measured through the same offset the draft room
 * uses, so twelve people watching the same countdown see the same number.
 */
export default function DraftCountdown({
  draftAt,
  skew,
  state,
  isCommissioner,
  managers,
  onStart,
  busy,
  meReady = false,
  onReady,
  hasIntro = false,
  onPrimeIntro,
  onCountdownReached,
}: {
  draftAt: string | null;
  skew: number;
  state: "pending" | "lobby" | "lottery" | "running" | "paused" | "complete";
  isCommissioner: boolean;
  managers: { id: string; franchise: string; ready?: boolean }[];
  onStart: () => void;
  busy: boolean;
  meReady?: boolean;
  onReady?: () => void | Promise<void>;
  /** Only to word the Ready button's explanation; the room owns the film. */
  hasIntro?: boolean;
  /** Unlocks the film's sound on a real click. See markReady below. */
  onPrimeIntro?: () => void;
  /** The clock has reached the hour. The room decides what to do about it. */
  onCountdownReached?: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());

  // Held in a ref so the tick below does not restart every time the room
  // re-renders around it. Written from an effect rather than during render,
  // which is the rule the compiler enforces.
  const reached = useRef(onCountdownReached);
  useEffect(() => {
    reached.current = onCountdownReached;
  }, [onCountdownReached]);

  /**
   * Ready does two things, and the second is the one that matters tonight.
   *
   * It marks the franchise in, which the room can count. And because it is a
   * real click, it is the moment the browser will let us unlock the film's
   * sound — so the unlocking happens here, inside the handler, on the very
   * element that plays later. Anywhere else and it is refused.
   */
  async function markReady() {
    onPrimeIntro?.();
    await onReady?.();
  }

  const target = draftAt ? new Date(draftAt).getTime() : null;

  useEffect(() => {
    // The crossing of zero is noticed on the tick that already runs the
    // countdown, not in an effect of its own. That way it is spotted the same
    // way whether the page was open all along or opened a minute late, and
    // there is one clock rather than two.
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);

      if (target == null) return;

      const since = at + skew - target;
      // A window rather than an instant, so somebody who opened the page
      // shortly after the hour still catches the opening titles. Past it the
      // draft is under way and the film would be an interruption.
      if (since < 0 || since > 5 * 60_000) return;

      reached.current?.();
    }, 1000);

    return () => clearInterval(timer);
  }, [target, skew]);

  const remaining = target ? Math.max(0, target - (now + skew)) : null;

  const parts =
    remaining == null
      ? null
      : {
          days: Math.floor(remaining / 86_400_000),
          hours: Math.floor((remaining % 86_400_000) / 3_600_000),
          mins: Math.floor((remaining % 3_600_000) / 60_000),
          secs: Math.floor((remaining % 60_000) / 1000),
        };

  const past = remaining != null && remaining <= 0;
  const readyCount = managers.filter((m) => m.ready).length;

  return (
    <div style={{ padding: "48px 26px 60px", textAlign: "center" }}>
      <div style={{ fontSize: 10, letterSpacing: ".4em", color: "#75798c" }}>
        {state === "paused" ? "DRAFT PAUSED" : past ? "DRAFT DAY" : "THE DRAFT"}
      </div>

      <h1
        style={{
          fontFamily: "var(--font-heading)",
          fontSize: 40,
          letterSpacing: "-.035em",
          margin: "10px 0 22px",
          fontWeight: 500,
        }}
      >
        {state === "paused"
          ? "Paused by the commissioner"
          : past
            ? "Waiting on the commissioner"
            : "Not open yet"}
      </h1>

      {parts && !past ? (
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            gap: 22,
            flexWrap: "wrap",
            margin: "0 0 26px",
          }}
        >
          {[
            { n: parts.days, label: "DAYS" },
            { n: parts.hours, label: "HOURS" },
            { n: parts.mins, label: "MINUTES" },
            { n: parts.secs, label: "SECONDS" },
          ].map((p) => (
            <div key={p.label} style={{ minWidth: 74 }}>
              <div
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: 46,
                  lineHeight: 1,
                  color: "#d2cefd",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {String(p.n).padStart(2, "0")}
              </div>
              <div style={{ fontSize: 10, letterSpacing: ".26em", color: "#75798c", marginTop: 6 }}>
                {p.label}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <p
        style={{
          fontSize: 13,
          color: "#9397ab",
          lineHeight: 1.7,
          maxWidth: "56ch",
          margin: "0 auto 24px",
        }}
      >
        {state === "paused"
          ? "The board is held where it was. Nobody's clock is running."
          : draftAt == null
            ? "No draft date is set yet. The commissioner opens the room when everyone is here."
            : past
              ? "The clock has run out. The commissioner opens the room."
              : `${managers.length} franchises. The room opens on its own schedule — the commissioner starts it.`}
      </p>

      <div style={{ marginBottom: 26 }}>
        <button
          onClick={() => void markReady()}
          disabled={busy || meReady}
          style={{
            padding: "13px 30px",
            border: `1px solid ${meReady ? "rgba(127,209,168,.55)" : "rgba(181,171,252,.6)"}`,
            background: meReady ? "rgba(127,209,168,.1)" : "rgba(145,132,217,.16)",
            color: meReady ? "#7fd1a8" : "#e9e9ed",
            borderRadius: "var(--radius-sm)",
            font: "inherit",
            fontSize: 13,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            cursor: busy || meReady ? "default" : "pointer",
            opacity: busy ? 0.5 : 1,
          }}
        >
          {meReady ? "You're ready" : "I'm ready"}
        </button>

        <p
          style={{
            fontSize: 11.5,
            color: "#75798c",
            lineHeight: 1.6,
            maxWidth: "48ch",
            margin: "12px auto 0",
          }}
        >
          {readyCount} of {managers.length} in.{" "}
          {meReady
            ? hasIntro
              ? "Sound is unlocked — the opening film will play out loud."
              : "Sound is unlocked for the draft room."
            : hasIntro
              ? "Press it before the clock runs out: browsers keep a video silent until you have pressed something, and this is what lets the opening film play out loud."
              : "Press it before the clock runs out: browsers keep sound off until you have pressed something, and this is what turns the pick chime on."}
        </p>
      </div>

      {isCommissioner ? (
        <button
          onClick={onStart}
          disabled={busy}
          style={{
            padding: "13px 30px",
            border: "1px solid rgba(181,171,252,.6)",
            background: "transparent",
            color: "#d2cefd",
            borderRadius: "var(--radius-sm)",
            font: "inherit",
            fontSize: 13,
            letterSpacing: ".14em",
            textTransform: "uppercase",
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.5 : 1,
          }}
        >
          {state === "paused" ? "Resume the draft" : "Open the draft room"}
        </button>
      ) : null}
    </div>
  );
}
