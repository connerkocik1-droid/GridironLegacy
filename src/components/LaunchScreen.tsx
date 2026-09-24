"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import LaunchIntro from "./LaunchIntro";
import PressStart from "./PressStart";
import { setMusic } from "@/lib/use-theme-music";
import type { Cut } from "@/lib/launch-intro/scene";

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
 * — four seconds for the static pylon below, or the animated intro's own
 * cut length while that is mounted — so a build where this component never
 * runs at all still ends up at the app rather than at a permanent orange
 * pylon.
 *
 * On a standalone open that isn't reduced-motion, this hands off to
 * LaunchIntro instead: the 16-bit catch-and-dive animation, full length on
 * the first open of the day and a shorter replay on every later one. See
 * src/lib/launch-intro for that choreography.
 */

/**
 * The shortest time worth showing the static pylon for. Under this it is a
 * flicker, which reads as a fault rather than as a launch — so on a warm
 * start it waits, and the wait is the price of it looking deliberate every
 * time. LaunchIntro plays out its own full length instead of waiting on this.
 */
const MINIMUM_MS = 420;

const INTRO_DAY_KEY = "pylon:intro-day";

/** Set once the title screen has been pressed, for the life of this launch. */
const STARTED_KEY = "pylon:started";

/**
 * Whether to open on the title screen.
 *
 * Only in the sixteen-bit theme, and only once per launch. The theme is read
 * off the root element rather than out of storage because the inline script in
 * layout.tsx has already resolved it there before the first paint — which is
 * also what stops this flashing up for somebody on the dark theme.
 *
 * Unlike the launch screen below, this is not limited to standalone. A title
 * screen is not a splash: it is the one press that lets the music play at all,
 * and a manager in a browser tab who chose the cartridge theme wants the
 * cartridge.
 */
function computeGate(): boolean {
  if (document.documentElement.dataset.theme !== "16bit") return false;
  try {
    return window.sessionStorage.getItem(STARTED_KEY) !== "1";
  } catch {
    // No session to remember it in. Better the title screen every reload than
    // a theme whose music never plays.
    return true;
  }
}

function pickCut(): Cut {
  const today = new Date().toLocaleDateString("en-CA");
  try {
    const cut: Cut = window.localStorage.getItem(INTRO_DAY_KEY) === today ? "short" : "full";
    window.localStorage.setItem(INTRO_DAY_KEY, today);
    return cut;
  } catch {
    // Private mode, or storage disabled: no day to remember, so play safe.
    return "short";
  }
}

type Mode = "static" | Cut;

/** The music switch, as the title screen needs to describe it. */
function computeSound(): boolean {
  try {
    return window.localStorage.getItem("gl.retro.music") !== "off";
  } catch {
    return true;
  }
}

let gateCache: boolean | null = null;
let soundCache: boolean | null = null;

function getSound(): boolean {
  if (soundCache === null) soundCache = computeSound();
  return soundCache;
}

function getServerSound(): boolean {
  return true;
}

function getGate(): boolean {
  if (gateCache === null) gateCache = computeGate();
  return gateCache;
}

/** No title screen in the server's HTML: it is a choice only the client knows. */
function getServerGate(): boolean {
  return false;
}

// Standalone-ness and reduced-motion don't change over the life of this
// component, and the day-key read in pickCut() must happen at most once —
// so this is decided once per page load and cached, the same one-shot
// pattern use-theme.ts uses for its own client-only read.
let modeCache: Mode | null = null;

function computeMode(): Mode {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (!standalone || reducedMotion) return "static";
  return pickCut();
}

function getMode(): Mode {
  if (modeCache === null) modeCache = computeMode();
  return modeCache;
}

// No real subscription: this is a one-shot client read with a hydration-safe
// server snapshot, not a value that changes under the component.
function subscribeNever() {
  return () => {};
}

function getServerMode(): Mode {
  return "static";
}

export default function LaunchScreen() {
  const mode = useSyncExternalStore(subscribeNever, getMode, getServerMode);
  const gate = useSyncExternalStore(subscribeNever, getGate, getServerGate);
  const sound = useSyncExternalStore(subscribeNever, getSound, getServerSound);
  const [waiting, setWaiting] = useState(true);

  // While the title screen is up, the launch screen behind it must not time
  // itself out — its four-second failsafe would fire during a press that has
  // not happened yet, and the intro would then mount into a sheet that had
  // already faded. Removing the attribute restarts that animation from zero.
  useEffect(() => {
    if (!gate || !waiting) return;
    document.documentElement.dataset.pressStart = "1";
    return () => {
      delete document.documentElement.dataset.pressStart;
    };
  }, [gate, waiting]);

  const start = useCallback(() => {
    setWaiting(false);
    try {
      window.sessionStorage.setItem(STARTED_KEY, "1");
    } catch {
      // Then the title screen comes back next reload, which is the safe way
      // round: a press too many beats a theme that never makes a sound.
    }
    // Only ever turns it on for somebody who has not turned it off. The switch
    // in the header is a decision, and a title screen does not overrule one.
    try {
      if (window.localStorage.getItem("gl.retro.music") !== "off") setMusic(true);
    } catch {
      setMusic(true);
    }
  }, []);

  useEffect(() => {
    if (gate && waiting) return;
    if (mode !== "static") return;

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
  }, [mode, gate, waiting]);

  if (gate && waiting) {
    return <PressStart onStart={start} sound={sound} />;
  }

  if (mode !== "static") {
    return <LaunchIntro cut={mode} />;
  }

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
