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
      <div
        style={{
          position: "absolute",
          top: "-12%",
          left: "-10%",
          width: "55%",
          height: "42%",
          borderRadius: "50%",
          background: "radial-gradient(circle,rgb(var(--glow-rgb) / .5),transparent 66%)",
          filter: "blur(40px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: "28%",
          right: "-16%",
          width: "50%",
          height: "42%",
          borderRadius: "50%",
          background: "radial-gradient(circle,rgb(var(--accent-rgb) / .3),transparent 64%)",
          filter: "blur(46px)",
        }}
      />
      <div
        style={{
          position: "absolute",
          bottom: "-14%",
          left: "-6%",
          width: "55%",
          height: "36%",
          borderRadius: "50%",
          background: "radial-gradient(circle,rgb(var(--glow-rgb) / .55),transparent 66%)",
          filter: "blur(46px)",
        }}
      />
    </div>
  );
}
