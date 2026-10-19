"use client";

import { useRetro } from "@/lib/retro";

/**
 * The pylon and the wordmark, and the bounce they do.
 *
 * On arrival and again on a tap, rather than on a loop. A loop is charming for
 * about a day on a screen people open twenty times, and then it is a thing
 * moving in the corner of the eye of somebody trying to read a score. Tapping
 * it replays, which is the whole of why anybody would want it.
 *
 * Retro only, and declared in CSS rather than here: a squash-and-stretch on a
 * flat modern header reads as a rendering fault, and under scanlines it reads
 * as a title screen — and a manager who has asked for less motion is answered
 * by the stylesheet rather than by this component remembering to ask.
 *
 * Its own component only because it listens for a tap, and a server component
 * cannot hold an event handler. Nav is rendered on every page and has no other
 * reason to ship to the browser, so the interactive part moved rather than the
 * whole header: the cost of this animation is this file and nothing else.
 */
export default function HeaderMark() {
  const retro = useRetro();
  return (
  <div
    className="gl-mark"
    onClick={(e) => {
      // Restarting an animation means taking it off and putting it back;
      // the read of offsetWidth is what forces the browser to notice.
      const el = e.currentTarget;
      el.classList.remove("gl-bounce");
      void el.offsetWidth;
      el.classList.add("gl-bounce");
    }}
    style={{ display: "flex", alignItems: "center", gap: 8, flex: "1 1 auto", minWidth: 0, overflow: "hidden" }}
  >
    {/* The 1b Hologram pylon from prototype/Pylon Logo.dc.html, at the small
        size the redesign's header draws it: a pylon in the pylon's own orange,
        the one deliberate exception to the indigo palette. */}
    <svg
      width="12"
      height="24"
      viewBox="28 6 44 108"
      aria-hidden
      style={{ flex: "0 0 auto", overflow: "visible", filter: "drop-shadow(0 0 3px rgba(245,138,68,.7))" }}
    >
      <polygon points="32,20 50,30 50,110 32,100" fill="rgba(255,180,106,.42)" />
      <polygon points="50,30 68,20 68,100 50,110" fill="rgba(245,138,68,.72)" />
      <polygon points="50,8 70,19 50,30 30,19" fill="#ffe2c4" />
      <polygon points="32,62 50,72 68,62 68,72 50,82 32,72" fill="#161826" opacity={0.75} />
      <line x1="50" y1="30" x2="50" y2="110" stroke="#ffe2c4" strokeWidth={4} />
    </svg>
    <span
      className="gl-wordmark"
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 5,
        whiteSpace: "nowrap",
        fontSize: 11,
        letterSpacing: ".16em",
        textTransform: "uppercase",
        fontStyle: "italic",
      }}
    >
      <span style={{ fontWeight: 600 }}>Pylon</span>
      <span style={{ fontWeight: 400, color: "var(--ap-a300)" }}>Fantasy</span>
    </span>
    {/* Sixteen-bit mode's badge, inline beside the wordmark so it can never
        land on anything else in the header. */}
    {retro ? (
      <span aria-hidden className="gl-px-badge" style={{ marginLeft: -4 }}>
        ●16
      </span>
    ) : null}
  </div>
  );
}
