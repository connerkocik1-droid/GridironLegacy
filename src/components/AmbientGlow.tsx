/**
 * The three blurred glows every liquid-glass panel in the redesign sits
 * over, mounted once here rather than redrawn per page. Fixed and behind
 * everything, so it never scrolls or re-renders with the route.
 */
export default function AmbientGlow() {
  return (
    <div
      aria-hidden
      // Hidden in sixteen-bit mode, where nothing is glass.
      data-glow="1"
      style={{
        position: "fixed",
        inset: 0,
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      {/* The redesign's three glows: section-glow top left, the deep accent
          on the right, section bottom left. */}
      <div
        style={{
          position: "absolute",
          top: -160,
          left: -140,
          width: 460,
          height: 420,
          background: "radial-gradient(circle,var(--ap-section-glow),transparent 66%)",
          filter: "blur(30px)",
          opacity: 0.8,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 300,
          right: -200,
          width: 420,
          height: 420,
          background: "radial-gradient(circle,var(--ap-a800),transparent 64%)",
          filter: "blur(40px)",
          opacity: 0.75,
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: -120,
          left: -60,
          width: 460,
          height: 360,
          background: "radial-gradient(circle,var(--ap-section),transparent 66%)",
          filter: "blur(40px)",
          opacity: 0.85,
        }}
      />
    </div>
  );
}
