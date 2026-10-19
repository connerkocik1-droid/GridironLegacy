"use client";

import { setMusic, useMusic } from "@/lib/use-theme-music";
import { useResolvedTheme } from "@/lib/use-theme";

/**
 * The switch that silences the retro theme's music.
 *
 * In the header, beside the bell and the avatar, rather than floating over the
 * page. It started life fixed to the bottom-left corner on the theory that a
 * switch you want is a switch you want *now* — and the first screenshot of it
 * showed a forty-pixel square sitting on top of a roster row. Nothing in this
 * app covers content, and a mute button is not the thing to make the exception
 * for. The header is on every screen too, and it is where the app's other two
 * standing controls already are.
 *
 * Renders nothing off the sixteen-bit theme, where there is no music to stop.
 * Its own component, and a client one, because Nav is a server component and
 * this needs both a hook and an onClick.
 */
export default function MusicToggle() {
  const retro = useResolvedTheme() === "16bit";
  const on = useMusic();

  if (!retro) return null;

  return (
    <button
      type="button"
      onClick={() => setMusic(!on)}
      aria-pressed={on}
      aria-label={on ? "Turn the music off" : "Turn the music on"}
      title={on ? "Music on" : "Music off"}
      className="gl-music"
      style={{
        width: 32,
        height: 32,
        flex: "0 0 auto",
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
