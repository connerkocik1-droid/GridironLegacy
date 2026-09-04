"use client";

import { useSyncExternalStore } from "react";

/**
 * Light, dark, or whatever the phone is set to.
 *
 * The choice lives in one localStorage key and is written onto the root
 * element as data-theme, which is the only thing the stylesheet reads. Two
 * consequences worth knowing:
 *
 *   "system" is resolved here rather than by a media query in CSS, so the
 *   palette is one list of values instead of two identical ones — and a
 *   manager can pick Light on a phone that is set to Dark.
 *
 *   The same resolution runs in an inline script before the first paint (see
 *   layout.tsx). Without it the page draws dark and then flips, which on a
 *   home-screen launch is the first thing anybody sees.
 */

export type Choice = "light" | "dark" | "system";

export const THEME_KEY = "pylon:theme";

const listeners = new Set<() => void>();
let choice: Choice = "system";
let started = false;

function readStored(): Choice {
  try {
    const said = localStorage.getItem(THEME_KEY);
    return said === "light" || said === "dark" ? said : "system";
  } catch {
    // A browser with storage turned off follows the system and cannot choose.
    return "system";
  }
}

/** What "system" currently means. */
function systemIs(): "light" | "dark" {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: light)").matches
    ? "light"
    : "dark";
}

function paint() {
  const resolved = choice === "system" ? systemIs() : choice;
  document.documentElement.dataset.theme = resolved;
}

export function setTheme(next: Choice) {
  choice = next;
  try {
    if (next === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, next);
  } catch {
    // The choice still applies to this page; it just will not be remembered.
  }
  paint();
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);

  if (!started) {
    started = true;
    choice = readStored();
    paint();

    // A phone that switches to dark at sunset moves the app with it, but only
    // for somebody who has not chosen for themselves.
    const watch = matchMedia?.("(prefers-color-scheme: light)");
    watch?.addEventListener?.("change", () => {
      if (choice !== "system") return;
      paint();
      for (const listener of listeners) listener();
    });
  }

  return () => {
    listeners.delete(onChange);
  };
}

export function useTheme(): Choice {
  return useSyncExternalStore(
    subscribe,
    () => choice,
    () => "system",
  );
}
