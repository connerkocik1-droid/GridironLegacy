"use client";

/**
 * The shape of what is coming, while it comes.
 *
 * Every screen in this app opened with a line of grey text — "Reading the
 * league…", "Reading your roster…" — which is honest and does two things
 * wrong. It tells you nothing about what is about to appear, so the page
 * arrives as a surprise and jumps under your thumb. And it reads as a delay
 * rather than as progress, which makes a fast load feel slow: half a second of
 * a sentence about waiting is longer than half a second of a page assembling.
 *
 * A skeleton fixes both. It reserves the space the real thing will take, so
 * nothing moves when it lands, and it is obviously the page rather than a
 * message about the page.
 *
 * The shimmer is deliberately slow and low-contrast. A fast bright sweep is a
 * loading spinner wearing a costume; this should read as "nearly there",
 * not "look at me".
 */

export function SkeletonLine({
  width = "100%",
  height = 12,
  radius = 4,
  style,
}: {
  width?: number | string;
  height?: number;
  radius?: number;
  style?: React.CSSProperties;
}) {
  return (
    <div
      className="gl-skeleton"
      style={{ width, height, borderRadius: radius, ...style }}
    />
  );
}

/**
 * A stand-in for a row with a crest, a name under it, and a figure at the end
 * — which is the shape of very nearly every list in this app: a matchup side,
 * a roster row, a standings line, a player.
 */
export function SkeletonRow({ crest = true }: { crest?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        borderTop: "1px solid rgba(145,132,217,.12)",
      }}
    >
      {crest ? <SkeletonLine width={34} height={34} radius={8} /> : null}
      <div style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}>
        <SkeletonLine width="58%" height={13} />
        <SkeletonLine width="34%" height={10} />
      </div>
      <SkeletonLine width={44} height={18} />
    </div>
  );
}

/**
 * A whole panel of them, bordered like the card it stands in for.
 *
 * `rows` should match what the screen usually shows: too few and the page
 * still jumps when the real thing lands, which is the problem this exists to
 * solve.
 */
export default function Skeleton({
  rows = 3,
  title = true,
  crest = true,
  style,
}: {
  rows?: number;
  title?: boolean;
  crest?: boolean;
  style?: React.CSSProperties;
}) {
  return (
    <div
      // Announced as busy rather than as a pile of empty boxes, and its
      // contents hidden from a screen reader — there is nothing in here to
      // read out, and "blank blank blank" is worse than silence.
      role="status"
      aria-busy="true"
      aria-label="Loading"
      style={{ padding: "18px 26px 32px", ...style }}
    >
      {title ? (
        <div style={{ display: "grid", gap: 9, marginBottom: 16 }}>
          <SkeletonLine width={110} height={10} />
          <SkeletonLine width="52%" height={26} radius={6} />
        </div>
      ) : null}

      <div
        aria-hidden
        style={{
          border: "1px solid rgba(145,132,217,.16)",
          borderRadius: "var(--radius-lg)",
          background: "rgba(26,28,43,.4)",
          overflow: "hidden",
        }}
      >
        {Array.from({ length: rows }, (_, i) => (
          <SkeletonRow key={i} crest={crest} />
        ))}
      </div>
    </div>
  );
}
