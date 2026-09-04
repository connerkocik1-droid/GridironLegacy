"use client";

import { useEffect } from "react";

/**
 * What fills the screen between the icon being tapped and the app being there.
 *
 * iOS draws its own launch image first — the apple-touch-startup-image files
 * in public/icons/launch, one per screen because iOS ignores any that is not
 * an exact match. That covers the browser starting up. It stops the moment the
 * page paints, which is before React has hydrated and long before any board
 * has data, and what it hands over to is an empty page.
 *
 * This is the other half: the same pylon on the same ground, in the page
 * itself, so the OS splash and the app's first frame are one picture and the
 * handover is invisible. It goes when the app is interactive.
 *
 * Only in standalone. In a browser tab you can watch a page load — that is
 * what a browser looks like — and covering it would be a splash screen on a
 * website, which nobody has ever thanked anybody for.
 *
 * It cannot trap the app. The stylesheet fades it out on a timer of its own
 * four seconds in, so a build where this component never runs at all still
 * ends up at the app rather than at a permanent orange pylon.
 */

/**
 * The shortest time worth showing it for. Under this it is a flicker, which
 * reads as a fault rather than as a launch — so on a warm start it waits, and
 * the wait is the price of it looking deliberate every time.
 */
const MINIMUM_MS = 420;

export default function LaunchScreen() {
  useEffect(() => {
    const done = () => {
      document.documentElement.dataset.launched = "1";
    };

    // A frame first, so the browser has painted this at least once before the
    // clock on it starts.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(done, MINIMUM_MS);
    });

    return () => {
      cancelAnimationFrame(frame);
      if (timer) clearTimeout(timer);
    };
  }, []);

  return (
    <div id="gl-launch" aria-hidden>
      {/* The icon's own pylon, at the size it sits on the launch image, so the
          two are the same drawing at the same scale. */}
      <svg width="104" height="104" viewBox="0 0 512 512" aria-hidden>
        <defs>
          <linearGradient id="gl-launch-face" gradientUnits="userSpaceOnUse" x1="0" y1="128" x2="0" y2="414">
            <stop offset="0" stopColor="#ffb066" />
            <stop offset="1" stopColor="#e2662a" />
          </linearGradient>
          <linearGradient id="gl-launch-side" gradientUnits="userSpaceOnUse" x1="0" y1="128" x2="0" y2="414">
            <stop offset="0" stopColor="#d97b3c" />
            <stop offset="1" stopColor="#a8431a" />
          </linearGradient>
        </defs>
        <path d="M196 128 h84 l28 264 h-140 z" fill="url(#gl-launch-face)" />
        <path d="M280 128 h36 l24 264 h-32 z" fill="url(#gl-launch-side)" />
        <rect x="150" y="392" width="212" height="22" rx="11" fill="#2b2741" />
      </svg>
    </div>
  );
}
