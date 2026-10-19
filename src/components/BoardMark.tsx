"use client";

import { logo } from "@/data/league-data";
import { clubAbbrev, monogram } from "@/lib/club-mark";
import { useRetro } from "@/lib/retro";
import { teamLogoPx } from "@/lib/team-logo";

/**
 * A team's mark on a Pylon Report board.
 *
 * The NFL board gets the real club logo, matched off the nickname so a
 * misspelt city still lands. The college board gets a monogram in the same
 * tile, because the app ships thirty-two NFL logos and no college ones — the
 * letters are not a substitute for the artwork, they are what keeps the two
 * boards looking like one board until somebody supplies it.
 *
 * In sixteen-bit mode a real logo is pixelated by the stylesheet like every
 * other image, and a monogram tile becomes a 16x16 pixel mark from the same
 * generator the fantasy crests use — the fallback until a school's artwork is
 * supplied, never a replacement for it.
 */
export default function BoardMark({ team, size = 20 }: { team: string; size?: number }) {
  const abbrev = clubAbbrev(team);
  const src = abbrev ? logo(abbrev) : "";
  const retro = useRetro();

  const box: React.CSSProperties = {
    width: size,
    height: size,
    flex: "0 0 auto",
    display: "grid",
    placeItems: "center",
    borderRadius: "var(--radius-sm)",
  };

  if (!src && retro) {
    return (
      <span aria-hidden style={{
        ...box,
        background: `${teamLogoPx(team, monogram(team))} center / contain no-repeat`,
        imageRendering: "pixelated",
      }} />
    );
  }

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
    <img src={src} alt="" width={size} height={size}
      style={{ ...box, objectFit: "contain" }} />
  );
}
