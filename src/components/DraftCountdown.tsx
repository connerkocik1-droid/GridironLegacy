"use client";

import { useEffect, useState } from "react";
import IntroVideo from "./IntroVideo";

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
  introVideo,
}: {
  draftAt: string | null;
  skew: number;
  state: "pending" | "running" | "paused" | "complete";
  isCommissioner: boolean;
  managers: { id: string; franchise: string }[];
  onStart: () => void;
  busy: boolean;
  introVideo?: string | null;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [playing, setPlaying] = useState(false);

  const target = draftAt ? new Date(draftAt).getTime() : null;

  // Whether this browser has already sat through the intro for this particular
  // draft date. Kept in localStorage rather than in the database: the film is a
  // moment, not a record, and "has this person seen it" is a fact about this
  // browser rather than about the league. Moving the draft date makes it new
  // again, which is what a postponed draft ought to mean.
  const seenKey = draftAt ? `gl.intro.${draftAt}` : null;

  useEffect(() => {
    // The decision to play is taken on the tick that already runs the
    // countdown, not in an effect of its own. That way the crossing of zero is
    // noticed the same way whether the page was open all along or opened a
    // minute late, and there is one clock rather than two.
    const timer = setInterval(() => {
      const at = Date.now();
      setNow(at);

      if (!introVideo || target == null) return;

      const since = at + skew - target;
      // A window rather than an instant, so somebody who opened the page
      // shortly after the hour still catches the opening titles. Past it the
      // draft is under way and the film would be an interruption.
      if (since < 0 || since > 5 * 60_000) return;

      try {
        if (seenKey && window.localStorage.getItem(seenKey)) return;
      } catch {
        // Private browsing, or storage turned off. Play it; seeing the intro
        // twice is not worth failing over.
      }

      setPlaying(true);
    }, 1000);

    return () => clearInterval(timer);
  }, [introVideo, target, skew, seenKey]);

  /**
   * Remembers the film has been watched — on finishing or skipping, never on
   * starting, so a refresh partway through plays it again rather than losing
   * it for good.
   */
  function finishIntro() {
    setPlaying(false);
    try {
      if (seenKey) window.localStorage.setItem(seenKey, "1");
    } catch {
      // As above: nothing here is worth an error.
    }
  }

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

  return (
    <div style={{ padding: "48px 26px 60px", textAlign: "center" }}>
      {playing && introVideo ? (
        <IntroVideo src={introVideo} onDone={finishIntro} />
      ) : null}

      <div style={{ fontSize: 9, letterSpacing: ".4em", color: "#75798c" }}>
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
              <div style={{ fontSize: 9, letterSpacing: ".26em", color: "#75798c", marginTop: 6 }}>
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
