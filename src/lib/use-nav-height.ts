"use client";

import { useEffect, useState } from "react";

/**
 * How tall the nav bar is, so something below it can stick to its underside.
 *
 * Measured rather than written down. The bar is 61px on a phone and 56px on a
 * desktop today, and a number in a stylesheet would be wrong the first time
 * anything in it changed: too small and whatever sticks below it hides behind
 * it, too large and there is a stripe of page showing between them.
 *
 * Nought until it has measured, which is the right answer for the frame before
 * the bar exists — a rail stuck to the top of the window for one frame is
 * invisible; a rail offset by a guess is not.
 */
export function useNavHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const nav = document.querySelector<HTMLElement>(".gl-nav");
    if (!nav) return;

    // Inside a frame, so this is not a synchronous set during the effect.
    const measure = () =>
      requestAnimationFrame(() => setHeight(Math.round(nav.getBoundingClientRect().height)));

    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(nav);
    return () => watch.disconnect();
  }, []);

  return height;
}
