"use client";

/**
 * A franchise's picture, or its initials when it has none.
 *
 * The fallback is not a grey silhouette: a league of twelve blank circles
 * tells you nothing, while two letters in the franchise's own colour is
 * legible at sixteen pixels and different for every team.
 */
export default function TeamCrest({
  franchise,
  logo,
  size = 30,
}: {
  franchise: string;
  logo: string | null;
  size?: number;
}) {
  const initials = franchise
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");

  // A stable hue per franchise, so a team keeps its colour between visits.
  let hash = 0;
  for (const ch of franchise) hash = (hash * 31 + ch.charCodeAt(0)) % 360;

  return (
    <span
      aria-hidden
      style={{
        width: size,
        height: size,
        flex: "0 0 auto",
        borderRadius: "50%",
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        border: "1px solid rgba(181,171,252,.45)",
        background: logo ? "#11131f" : `hsl(${hash} 34% 26%)`,
        color: `hsl(${hash} 60% 82%)`,
        fontSize: Math.max(9, Math.round(size * 0.36)),
        letterSpacing: ".04em",
        fontFamily: "var(--font-heading)",
      }}
    >
      {logo ? (
        // Plain <img>: the source is a data URI held in the league's own
        // database, which next/image has nothing to optimise and no loader for.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logo}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : (
        initials || "?"
      )}
    </span>
  );
}
