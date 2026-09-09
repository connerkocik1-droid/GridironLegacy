"use client";

import { useEffect, useState } from "react";

/**
 * How long until football.
 *
 * A countdown rather than a time, and this is the one place in the app where
 * that is the right way round: everywhere else a kickoff is something you plan
 * an afternoon around, so it gets a day and a clock. Here it is the answer to
 * "is it Sunday yet", which is a duration.
 *
 * Nothing is drawn once the slate is under way — the ticker above is a better
 * answer by then — and nothing is drawn if the next kickoff cannot be read.
 */
export default function KickoffCountdown({ at }: { at: string | null }) {
  const target = at ? Date.parse(at) : NaN;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!Number.isFinite(target)) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [target]);

  if (!Number.isFinite(target)) return null;
  const left = target - now;
  if (left <= 0) return null;

  const s = Math.floor(left / 1000);
  const days = Math.floor(s / 86_400);
  const pad = (n: number) => String(n).padStart(2, "0");
  const clock = `${pad(Math.floor((s % 86_400) / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;

  return (
    <div
      role="status"
      aria-label="Time until kickoff"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "9px 18px 2px",
        fontSize: 11,
        letterSpacing: ".16em",
        color: "var(--warn)",
      }}
    >
      <span
        className="gl-live-dot"
        style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--warn)", flex: "0 0 auto" }}
      />
      KICKOFF IN {days ? `${days}D ` : ""}
      <span style={{ fontVariantNumeric: "tabular-nums" }}>{clock}</span>
    </div>
  );
}
