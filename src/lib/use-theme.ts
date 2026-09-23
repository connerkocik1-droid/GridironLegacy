"use client";

import { useSyncExternalStore } from "react";

/**
 * Light, dark, sixteen-bit, or whatever the phone is set to.
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

/**
 * "16bit" is a theme rather than a mode: it is not a darker dark or a lighter
 * light, and no phone setting resolves to it. So it can be chosen and it can
 * be stored, but "system" never means it.
 */
export type Choice = "light" | "dark" | "16bit" | "system";

/** Everything a stored value is allowed to be. */
const CHOICES = new Set<string>(["light", "dark", "16bit"]);

export const THEME_KEY = "pylon:theme";

const listeners = new Set<() => void>();
let choice: Choice = "system";
let started = false;

function readStored(): Choice {
  try {
    const said = localStorage.getItem(THEME_KEY);
    return said && CHOICES.has(said) ? (said as Choice) : "system";
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

/**
 * The pixel font, fetched the first time somebody actually picks the theme.
 *
 * Not through next/font, and not in the document head. next/font downloads at
 * build time and bakes the face into every page, so a font two managers will
 * ever see would be paid for by all twelve on every load — and a plain <link>
 * in the layout is the render-blocking request to somebody else's CDN that
 * this app deliberately removed when it self-hosted Inter.
 *
 * So it is fetched here, once, by the only person it is for. Everything using
 * it falls back to Inter, so a blocked CDN or a phone offline costs the theme
 * its letterforms and nothing else — the colours, the square corners and the
 * scanlines are all local.
 */
const PIXEL_FONT =
  "https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400;600&display=swap";

function loadPixelFont() {
  if (typeof document === "undefined") return;
  if (document.getElementById("pylon-pixel-font")) return;
  const link = document.createElement("link");
  link.id = "pylon-pixel-font";
  link.rel = "stylesheet";
  link.href = PIXEL_FONT;
  document.head.appendChild(link);
}

function paint() {
  const resolved = choice === "system" ? systemIs() : choice;
  document.documentElement.dataset.theme = resolved;
  if (resolved === "16bit") loadPixelFont();
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

/** What the root element is actually set to, once "system" is resolved. */
export type Resolved = "light" | "dark" | "16bit";

function resolved(): Resolved {
  return choice === "system" ? systemIs() : choice;
}

/**
 * The theme in force, rather than the choice that produced it.
 *
 * useTheme answers "what did they pick", which is what the picker needs and
 * is the wrong question for anything that renders differently per theme:
 * "system" is not a look. This answers "what is on screen", so a component can
 * ask whether it is in the retro theme without caring how it got there.
 *
 * Dark on the server, matching the pre-paint script's own fallback.
 */
export function useResolvedTheme(): Resolved {
  return useSyncExternalStore(subscribe, resolved, () => "dark");
}

export function useTheme(): Choice {
  return useSyncExternalStore(
    subscribe,
    () => choice,
    () => "system",
  );
}
