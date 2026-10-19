"use client";

import { useSyncExternalStore } from "react";

/**
 * Sixteen-bit mode: a second skin over whichever theme is on.
 *
 * Not a theme beside light and dark. It is a switch in the avatar menu, and
 * the whole skin hangs off one attribute — data-retro="1" on the root element
 * — which the stylesheet uses to remap the existing tokens to a navy-and-gold
 * console palette. No component forks into a retro version of itself.
 *
 * Session-only, on purpose: every launch starts modern. It is kept in
 * sessionStorage rather than in memory so a reload or a pull-to-refresh in the
 * middle of a game does not drop it, but a cold open of the home-screen app is
 * a new session and arrives on glass. The pre-paint script in layout.tsx reads
 * the same key, so a reload does not flash modern first.
 */

export const RETRO_KEY = "pylon:retro";

const listeners = new Set<() => void>();
let on = false;
let started = false;

function emit() {
  for (const listener of listeners) listener();
}

function paint() {
  if (on) document.documentElement.dataset.retro = "1";
  else delete document.documentElement.dataset.retro;
}

export function setRetro(next: boolean) {
  on = next;
  try {
    if (next) sessionStorage.setItem(RETRO_KEY, "1");
    else sessionStorage.removeItem(RETRO_KEY);
  } catch {
    // Storage off: it still applies to this page, and a reload starts modern,
    // which is what every launch does anyway.
  }
  paint();
  emit();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (!started) {
    started = true;
    // The pre-paint script has already decided; read what it wrote rather
    // than storage, so the two can never disagree.
    on = document.documentElement.dataset.retro === "1";
  }
  return () => {
    listeners.delete(onChange);
  };
}

/** Whether the sixteen-bit skin is on. Off on the server, as every launch is. */
export function useRetro(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => on,
    () => false,
  );
}

/* ------------------------------------------------------------- the cues ---
   The "sound" cues, which are visual only: there is no audio anywhere in the
   skin. Anything can fire one; RetroLayer draws it. Each is a no-op while the
   skin is off, so callers do not need to ask first. */

export type Cue = { kind: "blip"; at: number } | { kind: "fanfare"; at: number; text: string };

const cueListeners = new Set<(cue: Cue) => void>();

export function onCue(listener: (cue: Cue) => void): () => void {
  cueListeners.add(listener);
  return () => {
    cueListeners.delete(listener);
  };
}

function isOn(): boolean {
  return typeof document !== "undefined" && document.documentElement.dataset.retro === "1";
}

/** "♪ BLIP" over the tab bar, on any tab or sub-tab change. */
export function blip() {
  if (!isOn()) return;
  const cue: Cue = { kind: "blip", at: Date.now() };
  for (const listener of cueListeners) listener(cue);
}

/** "♪ TOUCHDOWN! ♪", for one of your own players' scoring plays. */
export function fanfare(text: string) {
  if (!isOn()) return;
  const cue: Cue = { kind: "fanfare", at: Date.now(), text };
  for (const listener of cueListeners) listener(cue);
}
