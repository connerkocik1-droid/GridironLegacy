"use client";

import { headshot } from "@/data/league-data";

/**
 * A player's face — the same photograph in both skins.
 *
 * A component rather than a src at each of the nine places a headshot is
 * drawn, so every face carries the gl-face class whatever the caller passed.
 * Everything but the source is passed straight through, so each of those nine
 * keeps its own size, border and class.
 *
 * In sixteen-bit mode the stylesheet pixelates every image through the #px16
 * filter (RetroLayer) at render time, from this same asset: there is no second
 * set of pre-pixelated faces, and a face is never hidden or swapped for other
 * art. The filter works in screen pixels, so a 500px photo drawn at 26px still
 * comes out as blocks — which nearest-neighbour scaling alone could not do.
 */

/** A 1x1 transparent GIF: the src for a man with no picture. */
const BLANK =
  "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  /** The player, as the pool spells him. */
  name: string;
};

export default function Headshot({ name, alt = "", className, ...rest }: Props) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      // The idle animation in sixteen-bit mode finds faces by this class.
      className={className ? `gl-face ${className}` : "gl-face"}
      src={headshot(name) || BLANK}
      alt={alt}
      {...rest}
    />
  );
}
