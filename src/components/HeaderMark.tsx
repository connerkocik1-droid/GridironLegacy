"use client";

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
    style={{ display: "flex", alignItems: "center", gap: 10, flex: "0 0 auto" }}
  >
    {/* The mark, and the same one as the home-screen icon: a pylon, in the
        pylon's own colour. It was an abstract purple slab, which was fine
        when the app was called something else and is a missed opportunity
        now that it is named after this object. */}
    <svg
      width="11"
      height="18"
      viewBox="0 0 11 18"
      aria-hidden
      style={{ flex: "0 0 auto", filter: "drop-shadow(0 0 9px rgba(226,102,42,.55))" }}
    >
      <path d="M2.6 0 h4.2 l2.6 18 h-9.4 z" fill="#f0913f" />
      <path d="M6.8 0 h1.6 l2.2 18 h-1.6 z" fill="#b8511f" />
    </svg>
    <span
      className="gl-wordmark"
      style={{
        fontFamily: "var(--font-heading)",
        letterSpacing: ".2em",
        textTransform: "uppercase",
        fontSize: 12,
        whiteSpace: "nowrap",
      }}
    >
      Pylon<span style={{ color: "var(--accent-link)" }}> Fantasy</span>
    </span>
  </div>
  );
}
