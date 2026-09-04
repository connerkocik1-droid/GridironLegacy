"use client";

import { useEffect, useRef, useState } from "react";
import { hasRefreshable, refreshAll } from "@/lib/use-refresh";

/**
 * Pull the page down to ask again.
 *
 * The boards already refresh themselves — every thirty seconds while the ball
 * is in the air, five minutes in February. What they had no way of doing was
 * refreshing because somebody wanted them to, and on a Sunday that is most of
 * what a manager is doing: looking at a number and wanting to know whether it
 * is the number. Without the gesture the only way to ask is to reload the
 * page, which on a home-screen launch means watching the whole app start
 * again.
 *
 * It is also the one gesture that says "this is an app" without a word. Every
 * phone owner already knows it; an app that does not answer to it feels like
 * a website with an icon.
 *
 * Three rules keep it from fighting the page:
 *
 *   It only arms at the very top. A pull that begins anywhere else is a
 *   scroll, and the listener stands down for the rest of that touch.
 *
 *   The first movement decides. If the finger goes sideways or up first, this
 *   never engages — a horizontal swipe through the matchup band must not
 *   drag the page.
 *
 *   It resists. The indicator moves half as far as the finger, so the pull
 *   has to be meant. Sixty-four pixels of travel commits it; anything less
 *   springs back and asks nothing.
 */

const THRESHOLD = 64;
const MAX = 96;
/** Below this the touch is not yet a gesture, only a finger settling. */
const SLOP = 8;

export default function PullToRefresh() {
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  // Refs, not state: none of these are drawn, and they change on every
  // touchmove. Only `pull` is state, because only `pull` is a picture.
  const start = useRef<{ x: number; y: number } | null>(null);
  const armed = useRef(false);
  const decided = useRef(false);
  const busyRef = useRef(false);
  const pullRef = useRef(0);
  /** Whether this gesture has already ticked, so it ticks once and not sixty. */
  const buzzed = useRef(false);

  useEffect(() => {
    // A pointer that cannot touch cannot pull.
    if (!window.matchMedia("(pointer: coarse)").matches) return;

    // The distance, in both places at once. The listeners are installed once
    // and would otherwise be closed over the pull from the render that
    // installed them, which is always nought — and writing the ref during a
    // render instead is the thing React asks you not to do.
    const apply = (next: number) => {
      pullRef.current = next;
      setPull(next);
    };

    const onStart = (e: TouchEvent) => {
      if (busyRef.current || e.touches.length !== 1) return;
      const t = e.touches[0];
      start.current = { x: t.clientX, y: t.clientY };
      // Armed only from the top of the document. scrollY can be fractionally
      // negative mid-bounce on iOS, hence the inequality.
      armed.current = window.scrollY <= 0 && hasRefreshable();
      decided.current = false;
    };

    const onMove = (e: TouchEvent) => {
      if (!armed.current || !start.current || busyRef.current) return;
      const t = e.touches[0];
      const dy = t.clientY - start.current.y;
      const dx = t.clientX - start.current.x;

      if (!decided.current) {
        if (Math.abs(dy) < SLOP && Math.abs(dx) < SLOP) return;
        // Down, and more down than across. Anything else is somebody else's
        // gesture and this one gets out of the way for the rest of the touch.
        if (dy <= 0 || Math.abs(dx) > Math.abs(dy)) {
          armed.current = false;
          return;
        }
        decided.current = true;
      }

      // The page has scrolled under the gesture — a fling that landed back at
      // the top, say. Let go rather than fighting it.
      if (window.scrollY > 0) {
        armed.current = false;
        apply(0);
        return;
      }

      // Half the distance, so the pull is felt as effort. preventDefault stops
      // the browser's own rubber band underneath it, which would otherwise
      // move the page and the indicator by different amounts.
      if (e.cancelable) e.preventDefault();
      const next = Math.min(MAX, (dy - SLOP) * 0.5);

      // A tick at the moment it would commit, so the threshold can be felt
      // rather than watched — which is the difference between a gesture you
      // aim and one you check. Once per pull, and silently absent on iOS,
      // which has never implemented this; there is no way to ask for the
      // system haptic from a web page, so the Android half of the league gets
      // it and the rest lose nothing they had.
      if (next >= THRESHOLD && !buzzed.current) {
        buzzed.current = true;
        try {
          navigator.vibrate?.(7);
        } catch {
          // A browser that exposes it and refuses it. Nothing to do about it.
        }
      } else if (next < THRESHOLD) {
        buzzed.current = false;
      }

      apply(next);
    };

    const onEnd = () => {
      const distance = pullRef.current;
      start.current = null;
      armed.current = false;
      decided.current = false;
      buzzed.current = false;

      if (distance < THRESHOLD) return apply(0);

      // Held at the threshold while it works, so the spinner has somewhere to
      // be. It is let go when the slowest board answers.
      busyRef.current = true;
      setBusy(true);
      apply(THRESHOLD);
      void refreshAll().finally(() => {
        busyRef.current = false;
        setBusy(false);
        apply(0);
      });
    };

    // Non-passive on purpose: this one calls preventDefault. The other two do
    // not, and say so, because a passive listener is cheaper to deliver.
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchmove", onMove, { passive: false });
    window.addEventListener("touchend", onEnd, { passive: true });
    window.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, []);

  const ready = pull >= THRESHOLD;
  const showing = pull > 0 || busy;

  return (
    <div
      aria-hidden={!busy}
      role={busy ? "status" : undefined}
      aria-live="polite"
      style={{
        position: "fixed",
        top: "env(safe-area-inset-top)",
        left: 0,
        right: 0,
        height: 0,
        display: "flex",
        justifyContent: "center",
        zIndex: 60,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          transform: `translateY(${showing ? pull + 8 : -40}px)`,
          opacity: showing ? Math.min(1, pull / 40 + (busy ? 1 : 0)) : 0,
          // Followed while the finger is down, eased once it is not: a pull
          // that lags the thumb feels broken, and a release that snaps back
          // without easing feels like a glitch.
          transition: busy || pull === 0 ? "transform 260ms cubic-bezier(0.2,0,0,1), opacity 200ms ease" : "none",
          width: 30,
          height: 30,
          borderRadius: "50%",
          display: "grid",
          placeItems: "center",
          // The well rather than a surface: this badge crosses the top bar on
          // its way down, and every surface token is white in the light theme
          // — against a white bar the chip was a shadow with an arc in it.
          background: "var(--well)",
          border: `1px solid ${ready || busy ? "rgb(var(--accent-bright-rgb) / .7)" : "rgb(var(--accent-rgb) / .42)"}`,
          boxShadow: "0 6px 18px rgb(var(--shadow-rgb) / .35)",
        }}
      >
        {/* An arc rather than a spinner while the finger is down: it draws
            itself round as the pull goes, so the gesture has a target and the
            commit point is somewhere you can see rather than guess. */}
        {/* The turning is on the arc rather than on the badge, so the two
            transforms never have to agree about a number. */}
        <svg
          className={busy ? "gl-pull-busy" : undefined}
          width="16"
          height="16"
          viewBox="0 0 16 16"
          aria-hidden
        >
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke="rgb(var(--accent-rgb) / .35)"
            strokeWidth="2"
          />
          <circle
            cx="8"
            cy="8"
            r="6"
            fill="none"
            stroke={ready || busy ? "var(--accent-link)" : "var(--accent-solid)"}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 6}
            strokeDashoffset={2 * Math.PI * 6 * (1 - (busy ? 0.3 : Math.min(1, pull / THRESHOLD)))}
            transform="rotate(-90 8 8)"
          />
        </svg>
      </div>
    </div>
  );
}
