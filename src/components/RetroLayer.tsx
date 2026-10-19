"use client";

import { useEffect, useState } from "react";
import { onCue, useRetro } from "@/lib/retro";

/** How long each cue is on screen; matches its keyframes in globals.css. */
const BLIP_MS = 760;
const FANFARE_MS = 2_600;

/**
 * Everything the sixteen-bit skin draws on top of the app rather than into it.
 *
 * Mounted once in the layout, above the router, so the overlays belong to the
 * screen and not to whichever page is on it:
 *
 *   The #px16 filter, which pixelates every image at render time — headshots,
 *   uploaded crests, club logos — from the same asset the modern skin shows.
 *   There is no second, pre-pixelated set of files. Always in the document,
 *   because it is inert until the stylesheet points an image at it.
 *
 *   Scanlines and a vignette, only while the skin is on.
 *
 *   The two cues: "♪ BLIP" over the tab bar on a tab or sub-tab change, and
 *   the "♪ TOUCHDOWN! ♪" banner. Visual only — nothing here makes a sound.
 */
export default function RetroLayer() {
  const retro = useRetro();
  const [blipAt, setBlipAt] = useState(0);
  const [fan, setFan] = useState<{ at: number; text: string } | null>(null);

  useEffect(
    () =>
      onCue((cue) => {
        if (cue.kind === "blip") setBlipAt(cue.at);
        // One banner at a time: a second play while one is showing waits for
        // the next one rather than knocking it off the screen.
        else setFan((was) => (was && cue.at - was.at < FANFARE_MS ? was : { at: cue.at, text: cue.text }));
      }),
    [],
  );

  useEffect(() => {
    if (!blipAt) return;
    const t = setTimeout(() => setBlipAt(0), BLIP_MS);
    return () => clearTimeout(t);
  }, [blipAt]);

  useEffect(() => {
    if (!fan) return;
    const t = setTimeout(() => setFan(null), FANFARE_MS);
    return () => clearTimeout(t);
  }, [fan]);

  return (
    <>
      {/* Sample one pixel per 3px cell, grow each sample back into a 3x3
          block, then posterize to six steps per channel. */}
      <svg width="0" height="0" aria-hidden style={{ position: "absolute" }}>
        <defs>
          <filter id="px16" x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feFlood x="1" y="1" width="1" height="1" />
            <feComposite width="3" height="3" />
            <feTile result="grid" />
            <feComposite in="SourceGraphic" in2="grid" operator="in" />
            <feMorphology operator="dilate" radius="1" result="px" />
            <feComponentTransfer in="px">
              <feFuncR type="discrete" tableValues="0 .2 .4 .6 .8 1" />
              <feFuncG type="discrete" tableValues="0 .2 .4 .6 .8 1" />
              <feFuncB type="discrete" tableValues="0 .2 .4 .6 .8 1" />
            </feComponentTransfer>
          </filter>
        </defs>
      </svg>

      {retro ? (
        <>
          <div aria-hidden className="gl-px-scan" />
          <div aria-hidden className="gl-px-vignette" />
          {fan ? (
            <div key={fan.at} role="status" className="gl-px-fanfare">
              <div className="gl-px-fanfare-head">♪ TOUCHDOWN! ♪</div>
              <div className="gl-px-fanfare-text">{fan.text}</div>
            </div>
          ) : null}
          {blipAt ? (
            <div key={blipAt} aria-hidden className="gl-px-blip">
              ♪ BLIP
            </div>
          ) : null}
        </>
      ) : null}
    </>
  );
}
