"use client";

import { useEffect, useRef } from "react";
import { useMusic } from "@/lib/use-theme-music";
import { useResolvedTheme } from "@/lib/use-theme";

/**
 * The retro theme's title music.
 *
 * Only in the sixteen-bit theme. On the flat themes the element is not
 * rendered at all, so nothing is fetched: the track is 1.3MB and a manager on
 * the dark theme should never pay for it.
 *
 * The switch that stops it is MusicToggle, in the header. This is only the
 * player, and it is here — in the layout, above the router — because every
 * screen in this app is a fresh mount: an <audio> inside a page would restart
 * the theme from bar one each time somebody pressed a tab.
 *
 * Two more things it has to get right, and both are about not being obnoxious:
 *
 * It never starts on its own. Off is the default, and no browser will autoplay
 * audio before an interaction anyway — so a default of "on" would be a promise
 * the platform refuses to keep, and the first thing anybody would hear is
 * nothing, followed by confusion about the button.
 *
 * It stops when the theme does. Switching to Light with the music on leaves a
 * Genesis soundtrack playing under a white page, which is nobody's idea of
 * anything. The choice is remembered, so switching back brings it with you.
 */
export default function ThemeMusic() {
  const retro = useResolvedTheme() === "16bit";
  const on = useMusic();
  const el = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = el.current;
    if (!audio) return;

    if (!on) {
      audio.pause();
      return;
    }

    // A rejected play() is the browser saying "not until they touch
    // something", which is not an error and must not be treated as one: the
    // switch stays on, and the next render after an interaction tries again.
    void audio.play().catch(() => {});
  }, [on, retro]);

  if (!retro) return null;

  return <audio ref={el} src="/assets/16bit-theme.mp3" loop preload="none" />;
}
