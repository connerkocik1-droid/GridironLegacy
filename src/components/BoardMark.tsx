"use client";

import { logo } from "@/data/league-data";
import { clubAbbrev, monogram } from "@/lib/club-mark";
import { usePixelArt } from "@/lib/use-pixel-art";

/**
 * A team's mark on a Pylon Report board.
 *
 * The NFL board gets the real club logo, matched off the nickname so a
 * misspelt city still lands. The college board gets a monogram in the same
 * tile, because the app ships thirty-two NFL logos and no college ones — the
 * letters are not a substitute for the artwork, they are what keeps the two
 * boards looking like one board until somebody supplies it.
 *
 * Goes through the sprite filter like every other mark, so it is a photograph
 * on the flat themes and pixel art on the retro one without knowing which.
 */
export default function BoardMark({ team, size = 20 }: { team: string; size?: number }) {
  const abbrev = clubAbbrev(team);
  const src = abbrev ? logo(abbrev) : "";
  const sprite = usePixelArt(src, Math.max(12, Math.round(size * 0.9)));

  const box: React.CSSProperties = {
    width: size,
    height: size,
    flex: "0 0 auto",
    display: "grid",
    placeItems: "center",
    borderRadius: "var(--radius-sm)",
  };

  if (!src) {
    return (
      <span aria-hidden style={{
        ...box,
        fontSize: Math.max(8, Math.round(size * 0.42)),
        fontFamily: "var(--font-heading)",
        letterSpacing: ".02em",
        color: "var(--accent-text)",
        background: "rgb(var(--accent-rgb) / .16)",
        border: "1px solid rgb(var(--accent-rgb) / .3)",
      }}>
        {monogram(team)}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={sprite} alt="" width={size} height={size}
      style={{ ...box, objectFit: "contain" }} />
  );
}
