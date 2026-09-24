"use client";

import { useEffect, useRef } from "react";
import { setMusic, useMusic } from "@/lib/use-theme-music";
import { useResolvedTheme } from "@/lib/use-theme";

/**
 * The retro theme's title music, and the switch that silences it.
 *
 * Only in the sixteen-bit theme. On the flat themes the element is not
 * rendered at all, so nothing is fetched: the track is 1.3MB and a manager on
 * the dark theme should never pay for it.
 *
 * Three things this has to get right, and all three are about not being
 * obnoxious:
 *
 * It never starts on its own. Off is the default, and no browser will autoplay
 * audio before an interaction anyway — so a default of "on" would be a promise
 * the platform refuses to keep, and the first thing anybody would hear is
 * nothing, followed by confusion about the button.
 *
 * It survives a navigation. Every screen in this app is a fresh mount, so an
 * <audio> inside a page would restart the theme from bar one each time
 * somebody pressed a tab. This lives in the layout, above the router.
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

  return (
    <>
      <audio ref={el} src="/assets/16bit-theme.mp3" loop preload="none" />
      <MuteButton on={on} />
    </>
  );
}

/**
 * Bottom left, above the tab bar and clear of it.
 *
 * Fixed rather than in the header because the header is a server component and
 * because this has to be reachable from every screen — the moment somebody
 * wants the music off, they want it off now, not after navigating to wherever
 * the button lives.
 */
function MuteButton({ on }: { on: boolean }) {
  return (
    <button
      type="button"
      onClick={() => setMusic(!on)}
      aria-pressed={on}
      aria-label={on ? "Turn the music off" : "Turn the music on"}
      title={on ? "Music on" : "Music off"}
      className="gl-music"
      style={{
        position: "fixed",
        left: "calc(10px + env(safe-area-inset-left))",
        bottom: "calc(68px + env(safe-area-inset-bottom))",
        zIndex: 60,
        width: 40,
        height: 40,
        display: "grid",
        placeItems: "center",
        // Square, like everything else in this theme.
        borderRadius: 0,
        border: `2px solid rgb(var(--accent-rgb) / ${on ? ".7" : ".32"})`,
        background: on ? "rgb(var(--accent-rgb) / .22)" : "rgb(var(--sunken-rgb) / .9)",
        color: on ? "var(--accent-text)" : "var(--text-dim)",
        cursor: "pointer",
        // The hard offset shadow the rest of the theme uses.
        boxShadow: "2px 2px 0 var(--accent-deep)",
        padding: 0,
      }}
    >
      {/* Drawn rather than an emoji: an emoji is a different typeface on every
          phone and none of them are sixteen-bit. Blocky on purpose — the
          speaker is three rectangles and the waves are two. */}
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden fill="currentColor">
        <path d="M2 7h3v4H2z M5 7l4-3v10l-4-3z" />
        {on ? (
          <>
            <path d="M11 6h2v6h-2z" />
            <path d="M14 4h2v10h-2z" />
          </>
        ) : (
          // A cross, in the same two-pixel grid as everything else.
          <path d="M11 6h2v2h-2z M13 8h2v2h-2z M15 6h2v2h-2z M11 10h2v2h-2z M15 10h2v2h-2z" />
        )}
      </svg>
    </button>
  );
}
