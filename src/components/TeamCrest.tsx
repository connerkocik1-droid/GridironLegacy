"use client";

/**
 * A franchise's picture, or a generated badge when it has none.
 *
 * The fallback is not a grey silhouette: a league of twelve blank circles
 * tells you nothing. It is a badge seeded from the franchise's name — a
 * shield, hex, circle, square or diamond in the team's own hue, with its
 * initials — so every team is different and keeps the same mark on every
 * screen. In sixteen-bit mode the same seed is drawn on a 16x16 grid, so the
 * team keeps its identity across both skins (see team-logo.ts).
 */

import { useRetro } from "@/lib/retro";
import { initialsOf, teamLogo, teamLogoPx } from "@/lib/team-logo";

export default function TeamCrest({
  franchise,
  logo,
  size = 30,
  shape = "circle",
}: {
  franchise: string;
  logo: string | null;
  size?: number;
  /** A box sits beside a name in a list; a circle is the profile button. */
  shape?: "circle" | "box";
  /**
   * Kept for the callers that pass it. Both now draw the generated badge: the
   * redesign gives every team without an upload its own mark everywhere it
   * appears, lists included, rather than an empty box.
   */
  fallback?: "initials" | "empty";
}) {
  const retro = useRetro();

  // No picture: the generated badge, which carries its own shape, so it is
  // drawn bare rather than inside the circle an uploaded picture is cropped to.
  if (!logo) {
    return (
      <span
        aria-hidden
        className="gl-crest"
        style={{
          width: size,
          height: size,
          flex: "0 0 auto",
          display: "inline-block",
          background: `${retro ? teamLogoPx(franchise, initialsOf(franchise)) : teamLogo(franchise, initialsOf(franchise))} center / contain no-repeat`,
          imageRendering: retro ? "pixelated" : undefined,
        }}
      />
    );
  }

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
        border: "1px solid rgb(var(--accent-bright-rgb) / .45)",
        background: "var(--well)",
      }}
    >
      {(
        // Plain <img>: the source is a data URI held in the league's own
        // database, which next/image has nothing to optimise and no loader for.
        // In sixteen-bit mode the stylesheet pixelates it through #px16 — the
        // upload itself is never touched.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logo} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      )}
    </span>
  );
}
