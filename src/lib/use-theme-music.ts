"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the retro theme's music is playing.
 *
 * A store rather than component state because two things have to agree about
 * it — the switch that toggles it and the element that plays it — and because
 * the answer has to survive a navigation. Every page in this app is a fresh
 * mount (see template.tsx), so anything held in a component restarts the track
 * from the top every time somebody presses a tab.
 *
 * On is the default. It was off, on the reasoning that a page which starts
 * making noise the moment it opens is the thing everybody hates about the web
 * — but that reasoning does not survive contact with what this theme is for.
 * Nobody turns the sixteen-bit theme on by accident; choosing it is choosing a
 * cartridge, and a cartridge has a title theme. The switch is still one press
 * away in the header, and a manager who presses it is remembered for good.
 *
 * What the default cannot do is make a browser play. None of them will start
 * audio before the page has been touched, so "on" here means armed rather than
 * sounding: ThemeMusic tries at once, and if it is refused it waits for the
 * first tap and tries again. See the note there.
 */
const KEY = "gl.retro.music";

let on: boolean | null = null;
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    // Anything but an explicit "off" is on, so a manager who has never touched
    // the switch gets the theme and one who has turned it off keeps silence.
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    // Private mode, or storage turned off. The default applies; it just will
    // not be remembered between visits.
    return true;
  }
}

function snapshot(): boolean {
  if (on === null) on = read();
  return on;
}

/**
 * On, which is what the overwhelming majority of first paints should say.
 *
 * The server cannot read localStorage, so one of the two groups sees the
 * switch flip after hydration. Better that it is the few who have turned the
 * music off than everybody else.
 */
function serverSnapshot(): boolean {
  return true;
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
