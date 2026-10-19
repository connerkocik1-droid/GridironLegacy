"use client";

import { headshot } from "@/data/league-data";
import { usePixelArt } from "@/lib/use-pixel-art";

/**
 * A player's face, as a sprite in the retro theme and a photograph everywhere
 * else.
 *
 * A component rather than a hook call at each of the nine places a headshot is
 * drawn, because every one of those places is inside a .map() and a hook
 * cannot be called in a loop. Everything but the source is passed straight
 * through, so each of those nine kept its own size, border and class exactly
 * as it had them — this is a swap of `src={headshot(x)}` for `name={x}` and
 * nothing else.
 *
 * Why this exists at all: the theme sets image-rendering: pixelated on every
 * image, and that does nothing here. Nearest-neighbour only shows when an
 * image is scaled *up*; a 500px headshot drawn at 26px is a downscale, and the
 * browser resamples it to a perfectly smooth little photograph. So the crests
 * looked like sprites and the faces did not, which is exactly what it looked
 * like. Running them through the canvas — down to a small grid, palette
 * quantised, back up by CSS — is the only thing that actually converts them.
 */

/** A 1x1 transparent GIF: the src for a man with no picture. */
const BLANK =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** Coarse enough to read as a sprite, fine enough to be a face. */
const MIN_GRID = 14;
const MAX_GRID = 26;

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  /** The player, as the pool spells him. */
  name: string;
};

export default function Headshot({ name, width, alt = "", className, ...rest }: Props) {
  const real = headshot(name) || "";

  // Capped at both ends rather than scaled straight off the display size. A
  // 54px face at 0.8 would be a 43-block grid, which is a small photograph
  // again — past about twenty-six blocks the eye stops reading it as drawn.
  const size = Number(width) || 28;
  const grid = Math.min(MAX_GRID, Math.max(MIN_GRID, Math.round(size * 0.8)));

  // The placeholder is already a 1x1 and has nothing to convert.
  const sprite = usePixelArt(real, grid);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      // Always carries the class, whatever else the caller passed. The idle
      // animation used to find these by "/headshots/" being in the src, which
      // worked right up until the sprite filter replaced the src with a data
      // URL — the faces converted and stopped breathing in the same commit.
      // Every face comes through here now, so a class is both possible and
      // the thing that cannot come apart again.
      className={className ? `gl-face ${className}` : "gl-face"}
      src={sprite || BLANK}
      alt={alt}
      width={width}
      {...rest}
    />
  );
}
