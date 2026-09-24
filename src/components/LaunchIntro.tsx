"use client";

import { useEffect, useRef } from "react";
import { CUT_DURATION, drawFrame, type Cut } from "@/lib/launch-intro/scene";

const HEADING_FONT = "700 19px 'Pixelify Sans'";

/**
 * The 16-bit launch animation itself: canvas, clock, audio and the handoff
 * to the app. Only ever mounted by LaunchScreen, and only for a standalone
 * open that isn't reduced-motion — everything else keeps today's static
 * pylon. See src/lib/launch-intro/scene.ts for the choreography this drives
 * frame by frame, ported from the pylon-intro-v2.jsx design handoff.
 */
export default function LaunchIntro({ cut }: { cut: Cut }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    // The safety fade in globals.css times out #gl-launch on its own; tie it
    // to this cut's real length so it can't cut the animation short, while
    // still clearing the screen if this effect never runs at all.
    document.documentElement.dataset.intro = cut;

    if (document.fonts && "load" in document.fonts) {
      document.fonts.load(HEADING_FONT).catch(() => {});
    }

    // Starts at open; not synced to the hit. Cold launches on iOS/Android
    // usually block this because the user hasn't tapped anything yet — that
    // silence is expected and there's no prompt for it.
    const audio = new Audio("/sounds/touchdown.mp3");
    audio.play().catch(() => {});

    const duration = CUT_DURATION[cut];
    let start: number | null = null;
    let raf = 0;
    let done = false;

    const tick = (now: number) => {
      if (start === null) start = now;
      const elapsed = (now - start) / 1000;
      const fontReady = document.fonts ? document.fonts.check(HEADING_FONT) : false;
      drawFrame(ctx, Math.min(elapsed, duration), cut, fontReady);
      if (elapsed >= duration) {
        if (!done) {
          done = true;
          document.documentElement.dataset.launched = "1";
        }
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      audio.pause();
      audio.src = "";
      delete document.documentElement.dataset.intro;
    };
  }, [cut]);

  return (
    // Same id as LaunchScreen's static pylon — never both mounted at once —
    // so it inherits its fixed positioning, z-index and safety-fade CSS.
    <div id="gl-launch" aria-hidden>
      <div style={{ position: "absolute", inset: 0, background: "#0a0820" }}>
        <canvas
          ref={canvasRef}
          width={130}
          height={282}
          style={{
            display: "block",
            width: "100%",
            height: "100%",
            objectFit: "cover",
            imageRendering: "pixelated",
          }}
        />
      </div>
    </div>
  );
}
