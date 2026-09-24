"use client";

/**
 * Turning an image into sixteen-bit pixel art, in the browser, at render.
 *
 * At render rather than at upload, which is the whole point: a manager who
 * uploads a crest tonight gets a sprite of it in the retro theme without
 * anybody regenerating anything, and the original is never touched — switch
 * back to dark and the photograph is still a photograph. It also means this
 * covers the thirty-two NFL marks and eight hundred headshots the app does not
 * own and could not pre-convert.
 *
 * Two operations, and both matter. Resampling to a small grid with smoothing
 * off is what makes the blocks; quantising the palette is what makes them look
 * like a console rather than like a small photograph. A sprite from 1993 had
 * a handful of colours per tile, and an unquantised downsample keeps hundreds
 * of nearly identical ones, which reads as "blurry" instead of "drawn".
 *
 * The output is deliberately tiny — a 24px-square PNG for a 44px crest — and
 * is scaled up by CSS with image-rendering: pixelated. Doing the enlargement in
 * CSS rather than on the canvas keeps the data URL small enough to sit in a
 * React tree without thinking about it.
 *
 * Everything here fails soft. A cross-origin image the host will not send CORS
 * headers for taints the canvas and makes toDataURL throw; a blocked CDN never
 * loads at all. Both end as null, and every caller falls back to the original
 * image, which the theme already renders with image-rendering: pixelated. That
 * fallback is a real one — it is what the whole theme looked like before this
 * existed, and it is fine.
 */

/** How many colour steps per channel. Four gives 64 colours, which is plenty. */
const LEVELS = 4;

/**
 * Results, kept for the life of the page.
 *
 * A crest appears in a dozen rows on the League table and a headshot appears
 * twice on a matchup; converting each one per mount would be a dozen canvases
 * for one image. Keyed by source and grid size, because the same logo is drawn
 * at 44px in a header and 14px in a row and they are not the same sprite.
 *
 * Promises rather than values, so twelve rows mounting at once share one piece
 * of work rather than starting twelve.
 */
const cache = new Map<string, Promise<string | null>>();

function load(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Without this the canvas is tainted and toDataURL throws. With it, a host
    // that does not send the header fails the load instead — which is the same
    // outcome for us, one step earlier.
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

/**
 * One image, as a sprite of `grid` blocks on its longest side.
 *
 * Returns null rather than throwing. There is no version of this worth
 * breaking a page over.
 */
export function pixelate(src: string, grid = 24): Promise<string | null> {
  if (!src) return Promise.resolve(null);

  const key = `${grid}:${src}`;
  const held = cache.get(key);
  if (held) return held;

  const work = (async (): Promise<string | null> => {
    try {
      const img = await load(src);

      // Keep the aspect ratio: a wordmark is not square and squaring it here
      // would stretch it before anybody saw it.
      const long = Math.max(img.naturalWidth, img.naturalHeight) || 1;
      const w = Math.max(1, Math.round((img.naturalWidth / long) * grid));
      const h = Math.max(1, Math.round((img.naturalHeight / long) * grid));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return null;

      // Smoothing off on the way down as well as on the way up. Left on, the
      // browser averages each block with its neighbours and the result is a
      // thumbnail rather than a sprite.
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, w, h);

      const frame = ctx.getImageData(0, 0, w, h);
      const px = frame.data;
      const step = 255 / (LEVELS - 1);

      for (let i = 0; i < px.length; i += 4) {
        // A pixel that is mostly transparent becomes entirely transparent.
        // Antialiased edges arrive as a halo of half-opaque grey, which on a
        // sprite reads as a smudge around the outline.
        if (px[i + 3] < 128) {
          px[i + 3] = 0;
          continue;
        }
        px[i + 3] = 255;
        px[i] = Math.round(Math.round(px[i] / step) * step);
        px[i + 1] = Math.round(Math.round(px[i + 1] / step) * step);
        px[i + 2] = Math.round(Math.round(px[i + 2] / step) * step);
      }

      ctx.putImageData(frame, 0, 0);
      return canvas.toDataURL("image/png");
    } catch {
      // Tainted canvas, a CDN that is not answering, a browser with no canvas
      // at all. The caller draws the original.
      return null;
    }
  })();

  cache.set(key, work);
  return work;
}

/** Only for tests: the cache outlives a page and would outlive a case. */
export function clearPixelCache() {
  cache.clear();
}
