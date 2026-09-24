"use client";

import { useEffect, useState } from "react";
import { pixelate } from "./pixelate";
import { useResolvedTheme } from "./use-theme";

/**
 * An image's sprite, in the theme that wants one.
 *
 * Returns the original source everywhere else, so a caller is one line:
 *
 *   const src = usePixelArt(logo(team), 20);
 *
 * Off the retro theme this does no work at all — no canvas, no fetch, no
 * state — because the hook returns before the effect has anything to do. The
 * cost of the whole feature to a manager on the dark theme is one string
 * comparison per image.
 *
 * While a sprite is being made the original is shown. A crest that blinks out
 * for a frame and back in is worse than one that sharpens a moment late, and
 * the theme already renders every image with image-rendering: pixelated, so
 * the before and after are closer than they sound.
 */
export function usePixelArt(src: string | null | undefined, grid = 24): string {
  const retro = useResolvedTheme() === "16bit";
  const key = `${grid}:${src ?? ""}`;

  // The sprite is stored with the image it was made from rather than on its
  // own, and the render compares the two. A row that is handed a new player
  // before the old player's sprite arrives would otherwise show one man's face
  // under another man's name for a frame — and clearing the state on the way
  // past is a synchronous setState in an effect, which is a cascading render.
  const [made, setMade] = useState<{ key: string; url: string } | null>(null);

  useEffect(() => {
    if (!retro || !src) return;

    // Guarded rather than cancelled: the work is cached and shared, so a late
    // arrival costs nothing. The guard is only about not setting state on a
    // component that has gone.
    let live = true;
    void pixelate(src, grid).then((url) => {
      if (live && url) setMade({ key, url });
    });
    return () => {
      live = false;
    };
  }, [retro, src, grid, key]);

  return (retro && made?.key === key ? made.url : src) || "";
}
