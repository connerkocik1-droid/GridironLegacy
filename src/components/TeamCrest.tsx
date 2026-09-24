"use client";

/**
 * A franchise's picture, or its initials when it has none.
 *
 * The fallback is not a grey silhouette: a league of twelve blank circles
 * tells you nothing, while two letters in the franchise's own colour is
 * legible at sixteen pixels and different for every team.
 */

import { usePixelArt } from "@/lib/use-pixel-art";
export default function TeamCrest({
  franchise,
  logo,
  size = 30,
  shape = "circle",
  fallback = "initials",
}: {
  franchise: string;
  logo: string | null;
  size?: number;
  /** A box sits beside a name in a list; a circle is the profile button. */
  shape?: "circle" | "box";
  /**
   * What to draw with no picture. Initials suit a single prominent crest;
   * beside a column of names an empty box is quieter and keeps the rows
   * aligned whether or not anybody has uploaded anything.
   */
  fallback?: "initials" | "empty";
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

  const lettered = fallback === "initials";

  // The retro theme redraws it as a sprite; every other theme gets the logo
  // back unchanged. Converted at render rather than at upload, so a crest a
  // manager uploads tonight is a sprite tonight and is still a photograph the
  // moment they switch back — and so this covers the marks the app does not
  // own as well as the ones it does.
  //
  // The grid follows the size it is drawn at: the same badge is a 44px header
  // crest and a 14px row mark, and one sprite for both would be mush at one
  // end or wasted detail at the other.
  const sprite = usePixelArt(logo, Math.max(12, Math.round(size * 0.55)));

  return (
    <span
      aria-hidden
      /* Named so a theme can reach it. The radius is inline and computed from
         the size, which no token can override — and a round crest is the one
         thing that stops the sixteen-bit theme reading as sixteen-bit. */
      className="gl-crest"
      style={{
        width: size,
        height: size,
        flex: "0 0 auto",
        borderRadius: shape === "circle" ? "50%" : Math.max(3, Math.round(size * 0.18)),
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        border: `1px solid ${
          logo || lettered ? "rgb(var(--accent-bright-rgb) / .45)" : "rgb(var(--accent-rgb) / .28)"
        }`,
        background: logo
          ? "var(--well)"
          : lettered
            ? `hsl(${hash} 34% 26%)`
            : "rgb(var(--sunken-rgb) / .6)",
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
          src={sprite}
          alt=""
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : lettered ? (
        initials || "?"
      ) : null}
    </span>
  );
}
