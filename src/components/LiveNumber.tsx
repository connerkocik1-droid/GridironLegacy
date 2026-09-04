"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A number that arrives rather than appears.
 *
 * On a Sunday afternoon the score is the whole app, and it was changing in
 * total silence: 104.6 became 111.2 between two polls and nothing on the
 * screen said a thing had happened. A manager watching a game had to remember
 * the old number to know the new one meant something — which is to say the
 * most important event in the product was invisible.
 *
 * So it counts. Six hundred and fifty milliseconds from the old figure to the
 * new one, and a flash of colour in the direction it moved: up for a
 * touchdown, down for the stat correction that takes one away three hours
 * later. Both are worth seeing, and the second is worth seeing *because* it is
 * unwelcome — points quietly vanishing is how a manager decides the app is
 * lying to them.
 *
 * Deliberately not animated on first sight. A page that opens by counting
 * every number on it up from zero is a slot machine; the count means "this
 * changed while you were looking", and it can only mean that if it is silent
 * the rest of the time.
 */

/** How long the figure takes to travel. Long enough to read, short enough to believe. */
const COUNT_MS = 650;

/** How long the colour stays after it lands. */
const FLASH_MS = 1_100;

/** Ease-out: quick off the mark, settling into the answer. */
const ease = (t: number) => 1 - Math.pow(1 - t, 3);

function wantsStillness(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

export default function LiveNumber({
  value,
  decimals = 1,
  style,
  /** Turns the count off where a number changes for a reason nobody scored. */
  animate = true,
}: {
  value: number;
  decimals?: number;
  style?: React.CSSProperties;
  animate?: boolean;
}) {
  const [shown, setShown] = useState(value);
  const [flash, setFlash] = useState<"up" | "down" | null>(null);
  const from = useRef(value);

  useEffect(() => {
    const start = from.current;
    if (start === value) return;

    if (!animate || wantsStillness()) {
      from.current = value;
      // Not synchronous: the frame callback runs after this effect returns, so
      // the render that draws the new figure is its own.
      const raf = requestAnimationFrame(() => {
        setShown(value);
        setFlash(value > start ? "up" : "down");
      });
      return () => cancelAnimationFrame(raf);
    }

    let raf = 0;
    let t0 = 0;

    const step = (now: number) => {
      if (!t0) t0 = now;
      const t = Math.min(1, (now - t0) / COUNT_MS);
      setShown(start + (value - start) * ease(t));
      if (t < 1) {
        raf = requestAnimationFrame(step);
      } else {
        from.current = value;
        setShown(value);
      }
    };

    raf = requestAnimationFrame((now) => {
      setFlash(value > start ? "up" : "down");
      step(now);
    });

    return () => cancelAnimationFrame(raf);
  }, [value, animate]);

  useEffect(() => {
    if (!flash) return;
    const timer = setTimeout(() => setFlash(null), FLASH_MS);
    return () => clearTimeout(timer);
  }, [flash]);

  return (
    <span
      // Re-keyed on each flash so the animation restarts rather than being
      // ignored for already running — two touchdowns in a minute must read as
      // two, not one.
      key={flash ? `${flash}-${value}` : undefined}
      className={flash ? `gl-tick gl-tick-${flash}` : undefined}
      style={{ fontVariantNumeric: "tabular-nums", ...style }}
    >
      {shown.toFixed(decimals)}
    </span>
  );
}
