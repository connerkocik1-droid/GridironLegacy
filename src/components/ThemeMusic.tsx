"use client";

import { useEffect, useRef } from "react";
import { useMusic } from "@/lib/use-theme-music";
import { useResolvedTheme } from "@/lib/use-theme";

/** How long to wait for the launch intro before giving up on it. */
const INTRO_GRACE_MS = 12_000;

/** The presses a browser will accept as "the page has been touched". */
const GESTURES = ["pointerdown", "touchstart", "keydown", "click"] as const;

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
 * It starts on its own, and the interesting part is what happens when it
 * cannot. No browser will play audio before the page has been touched, and a
 * cold launch is exactly that case — so the first play() is usually refused,
 * silently, with a rejected promise and no way to ask again. Treating that as
 * "the music is off" is how a default of on becomes a feature that works on a
 * desktop and never once on a phone. Instead the refusal arms a listener for
 * the first press anywhere in the app, which is a gesture the browser accepts,
 * and the theme comes in then — on the first tap rather than the first
 * navigation, and without anybody having to find the switch.
 *
 * It waits for the launch intro. That intro fires a touchdown sound of its
 * own, and two tracks over one cold open is not a title screen, it is a mess.
 * The intro flags itself on the document, so the wait is only as long as an
 * intro that is actually running, with a grace period in case it never
 * finishes.
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

    let dropped = false;
    const undo: Array<() => void> = [];
    const cleanup = () => {
      dropped = true;
      while (undo.length) undo.pop()?.();
    };

    // Resolves once no intro is playing: immediately when there is none (a
    // browser tab, or reduced motion), otherwise when the intro says it is
    // done — or when the grace period runs out, because a wait that depends
    // on an animation finishing must not be able to outlive it.
    const introOver = () => new Promise<void>((resolve) => {
      const root = document.documentElement;
      const clear = () => !root.dataset.intro || Boolean(root.dataset.launched);
      if (clear()) return resolve();

      const observer = new MutationObserver(() => {
        if (!clear()) return;
        observer.disconnect();
        resolve();
      });
      observer.observe(root, { attributes: true, attributeFilter: ["data-intro", "data-launched"] });
      const timer = setTimeout(() => {
        observer.disconnect();
        resolve();
      }, INTRO_GRACE_MS);

      undo.push(() => {
        observer.disconnect();
        clearTimeout(timer);
      });
    });

    // A rejected play() is the browser saying "not until they touch
    // something". It is not an error and must not be treated as one: the
    // switch stays on and this waits for the touch.
    const attempt = () => audio.play().then(() => true, () => false);

    const arm = () => {
      const onGesture = () => {
        void attempt().then((played) => {
          if (played) cleanup();
        });
      };
      for (const type of GESTURES) {
        document.addEventListener(type, onGesture, { passive: true });
        undo.push(() => document.removeEventListener(type, onGesture));
      }
    };

    void introOver().then(async () => {
      if (dropped) return;
      if (await attempt()) return;
      if (!dropped) arm();
    });

    return cleanup;
  }, [on, retro]);

  if (!retro) return null;

  // Fetched eagerly, unlike every other heavy thing here, because it is meant
  // to be playing seconds from now and a track that starts downloading on the
  // first tap arrives after it.
  return <audio ref={el} src="/assets/16bit-theme.mp3" loop preload="auto" />;
}
