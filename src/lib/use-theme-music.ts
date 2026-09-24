"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the retro theme's music is playing.
 *
 * A store rather than component state because two things have to agree about
 * it — the button that toggles it and the element that plays it — and because
 * the answer has to survive a navigation. Every page in this app is a fresh
 * mount (see template.tsx), so anything held in a component restarts the track
 * from the top every time somebody presses a tab.
 *
 * Off is the default, and deliberately. A page that starts making noise the
 * moment it opens is the thing everybody hates about the web; a manager who
 * wants a soundtrack turns it on once and the app remembers. Browsers agree —
 * none of them will autoplay audio before an interaction, so a default of "on"
 * would be a promise the platform refuses to keep.
 */
const KEY = "gl.retro.music";

let on: boolean | null = null;
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "on";
  } catch {
    // Private mode, or storage turned off. Silence is the safe default.
    return false;
  }
}

function snapshot(): boolean {
  if (on === null) on = read();
  return on;
}

/** Silent on the server, which is also what the first paint should be. */
function serverSnapshot(): boolean {
  return false;
}

export function setMusic(next: boolean) {
  on = next;
  try {
    window.localStorage.setItem(KEY, next ? "on" : "off");
  } catch {
    // It still applies to this page; it just will not be remembered.
  }
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function useMusic(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
