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
 * This is the other half: the loading screen from the "Pylon Loading" design
 * handoff. The hologram pylon draws itself in over about 1.4s, then loops
 * quietly — an edge pulse, a scan line, a breathing glow and a sweeping bar —
 * until the screen behind it has its first data. Every animation is CSS (the
 * keyframes are in globals.css), so it plays while the JavaScript is still
 * parsing; the script only decides when it goes.
 *
 * It goes when the app is ready: hydrated, and no screen still showing its
 * loading skeleton (every board's GroupSkeleton is aria-busy). Never before
 * 1.4s, so the intro always completes; and not at all, with no fade, if the
 * app was ready inside 250ms, because a flash of it reads as a fault.
 *
 * Only in standalone. In a browser tab you can watch a page load — that is
 * what a browser looks like — and covering it would be a splash screen on a
 * website, which nobody has ever thanked anybody for.
 *
 * It cannot trap the app. A board that never finishes loading lets it go at
 * MAXIMUM_MS, and the stylesheet fades it out on a timer of its own, so a
 * build where this component never runs at all still ends up at the app.
 */

/** The intro's own length: the drawing completes before it can leave. */
const MINIMUM_MS = 1400;
/** Ready this soon after the tap, and there is nothing to show. */
const SKIP_MS = 250;
/** However long the first data takes, the app is not hidden past this. */
const MAXIMUM_MS = 6000;

function busy(): boolean {
  return document.querySelector('[aria-busy="true"]') != null;
}

export default function LaunchScreen() {
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.launched) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let observer: MutationObserver | undefined;
    let settled = false;

    const finish = (how: "1" | "skip") => {
      if (settled) return;
      settled = true;
      observer?.disconnect();
      if (timer) clearTimeout(timer);
      root.dataset.launched = how;
    };

    // Ready: wait out the intro if it has not finished, else go now.
    const ready = () => {
      if (settled) return;
      const now = performance.now();
      if (now < SKIP_MS) return finish("skip");
      if (now >= MINIMUM_MS) return finish("1");
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => finish("1"), MINIMUM_MS - now);
    };

    const check = () => {
      if (!busy()) ready();
    };

    // A frame first, so the screen behind has rendered its first pass.
    const frame = requestAnimationFrame(() => {
      check();
      if (settled) return;
      observer = new MutationObserver(check);
      observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-busy"] });
    });
    const cap = setTimeout(() => finish("1"), Math.max(0, MAXIMUM_MS - performance.now()));

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(cap);
      if (timer) clearTimeout(timer);
      observer?.disconnect();
    };
  }, []);

  return (
    <div id="gl-launch" aria-hidden>
      {/* The ground: two of the app's glows and an orange one under the pylon. */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
        <div style={{ position: "absolute", top: -160, left: -140, width: 460, height: 420, borderRadius: "50%", background: "radial-gradient(circle, rgb(var(--glow-rgb) / .9), transparent 66%)", filter: "blur(30px)", opacity: 0.8 }} />
        <div style={{ position: "absolute", bottom: -120, right: -160, width: 460, height: 400, borderRadius: "50%", background: "radial-gradient(circle, rgb(var(--accent-rgb) / .22), transparent 66%)", filter: "blur(40px)", opacity: 0.85 }} />
        <div style={{ position: "absolute", top: "calc(50% - 137px)", left: "50%", width: 280, height: 200, marginLeft: -140, borderRadius: "50%", background: "radial-gradient(circle, rgba(245,138,68,.22), transparent 65%)", filter: "blur(20px)", animation: "pl-in .8s ease .5s both, pl-glow 2.4s ease-in-out 1.3s infinite" }} />
      </div>

      <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 26, paddingBottom: 40 }}>
        <div style={{ position: "relative", width: 150, height: 198 }}>
          <svg width="150" height="198" viewBox="0 0 100 132" style={{ overflow: "visible", display: "block" }}>
            <defs>
              <linearGradient id="ld-r" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#f58a44" stopOpacity=".42" />
                <stop offset="1" stopColor="#f58a44" stopOpacity=".04" />
              </linearGradient>
              <linearGradient id="ld-l" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#ffb46a" stopOpacity=".18" />
                <stop offset="1" stopColor="#ffb46a" stopOpacity="0" />
              </linearGradient>
              <linearGradient id="ld-g" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#9184d9" stopOpacity="0" />
                <stop offset=".5" stopColor="#b5abfc" />
                <stop offset="1" stopColor="#9184d9" stopOpacity="0" />
              </linearGradient>
              <clipPath id="ld-clip">
                <polygon points="32,20 50,30 68,20 68,100 50,110 32,100" />
              </clipPath>
            </defs>

            {/* The goal line, scaling out from the centre. */}
            <rect x="2" y="113" width="96" height="1.6" style={{ fill: "url(#ld-g)", filter: "drop-shadow(0 0 4px #9184d9)", transformOrigin: "50px 113px", animation: "pl-line .5s cubic-bezier(.2,.7,.2,1) .05s both" }} />

            <g style={{ animation: "pl-fill .5s ease .75s both" }}>
              <polygon points="32,20 50,30 50,110 32,100" style={{ fill: "url(#ld-l)" }} />
              <polygon points="50,30 68,20 68,100 50,110" style={{ fill: "url(#ld-r)" }} />
              <polygon points="50,10 68,20 50,30 32,20" style={{ fill: "rgba(255,180,106,.3)" }} />
            </g>

            {/* Outlines draw with pathLength=1, independent of their real length. */}
            <g style={{ fill: "none", stroke: "#ffb46a", strokeWidth: 1.1, strokeLinejoin: "round", filter: "drop-shadow(0 0 4px #f58a44)" }}>
              <polygon pathLength={1} points="32,20 50,30 50,110 32,100" style={{ strokeDasharray: 1, animation: "pl-draw .7s cubic-bezier(.4,0,.2,1) .2s both" }} />
              <polygon pathLength={1} points="50,30 68,20 68,100 50,110" style={{ strokeDasharray: 1, animation: "pl-draw .7s cubic-bezier(.4,0,.2,1) .3s both" }} />
              <polygon pathLength={1} points="50,10 68,20 50,30 32,20" style={{ strokeDasharray: 1, animation: "pl-draw .45s cubic-bezier(.4,0,.2,1) .55s both" }} />
            </g>

            <g style={{ stroke: "#ffb46a", strokeWidth: 0.5, opacity: 0.5, animation: "pl-in .4s ease .95s both" }}>
              <line x1="32" y1="44" x2="50" y2="54" />
              <line x1="50" y1="54" x2="68" y2="44" />
              <line x1="32" y1="64" x2="50" y2="74" />
              <line x1="50" y1="74" x2="68" y2="64" />
              <line x1="32" y1="84" x2="50" y2="94" />
              <line x1="50" y1="94" x2="68" y2="84" />
            </g>

            <line x1="50" y1="30" x2="50" y2="110" style={{ stroke: "#ffe2c4", strokeWidth: 1.6, filter: "drop-shadow(0 0 5px #f58a44)", animation: "pl-in .3s ease 1s both, pl-edge 1.6s ease-in-out 1.3s infinite" }} />

            <g style={{ clipPath: "url(#ld-clip)" }}>
              <rect className="pl-scanline" x="30" y="20" width="40" height="3" style={{ fill: "#ffe2c4", opacity: 0, filter: "blur(1px)", animation: "pl-scan 1.8s ease-in-out 1.3s infinite" }} />
            </g>
          </svg>
        </div>

        <div style={{ display: "flex", alignItems: "baseline", gap: 9, fontSize: 15, letterSpacing: ".2em", textTransform: "uppercase", fontStyle: "italic", whiteSpace: "nowrap", animation: "pl-word .6s cubic-bezier(.2,.7,.2,1) 1.05s both" }}>
          <span style={{ fontWeight: 600 }}>Pylon</span>
          <span style={{ fontWeight: 400, color: "var(--ap-a300)" }}>Fantasy</span>
        </div>
      </div>

      <div style={{ position: "absolute", left: 0, right: 0, bottom: "calc(92px + env(safe-area-inset-bottom))", display: "flex", flexDirection: "column", alignItems: "center", gap: 12, animation: "pl-in .4s ease 1.4s both" }}>
        <div style={{ position: "relative", width: 120, height: 2, borderRadius: 1, overflow: "hidden", background: "color-mix(in oklch, var(--text) 10%, transparent)" }}>
          <div className="pl-sweep" style={{ position: "absolute", top: 0, bottom: 0, left: 0, width: "40%", background: "linear-gradient(90deg,transparent,var(--ap-a200),transparent)", boxShadow: "0 0 8px var(--ap-accent)", animation: "pl-bar 1.3s cubic-bezier(.5,0,.5,1) 1.4s infinite" }} />
        </div>
        {/* Ambient copy, staggered 1.2s apart on a 3.6s cycle. */}
        <div style={{ position: "relative", height: 14, width: 220, fontSize: 10, letterSpacing: ".18em", color: "var(--ap-n400)", textAlign: "center" }}>
          <span className="pl-status-line" style={{ position: "absolute", inset: 0, opacity: 0, animation: "pl-status 3.6s ease 1.4s infinite" }}>SYNCING ROSTERS</span>
          <span className="pl-status-line" style={{ position: "absolute", inset: 0, opacity: 0, animation: "pl-status 3.6s ease 2.6s infinite" }}>PULLING LIVE SCORES</span>
          <span className="pl-status-line" style={{ position: "absolute", inset: 0, opacity: 0, animation: "pl-status 3.6s ease 3.8s infinite" }}>GRADING BEST BALL</span>
        </div>
      </div>
    </div>
  );
}
