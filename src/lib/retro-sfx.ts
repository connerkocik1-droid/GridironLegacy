"use client";

/**
 * The sixteen-bit theme's interface sounds.
 *
 * One file, one element, played from the top on every press. A fresh Audio per
 * press would leak an element for every tab somebody ever tapped, and a shared
 * element without the rewind goes silent after the first play because the
 * track has already ended.
 *
 * Not part of the music switch, deliberately. The music is a soundtrack you
 * choose to have on; this is the interface making a noise when you press it,
 * like the scanlines and the hard shadows are the interface looking like a
 * cartridge. It arrives with the theme and it leaves with the theme, and there
 * is nothing to mute because there is nothing playing between presses.
 *
 * Every call is guarded. Audio does not exist on the server, a browser may
 * refuse to play before the first interaction, and a phone on silent will
 * reject the promise — none of which is an error worth a console line, and all
 * of which would otherwise throw inside an onClick and take the navigation
 * with it.
 */

const TAB = "/assets/16bit-tab.mp3";

let el: HTMLAudioElement | null = null;

/** Fetches the file, so the first press is not the silent one. */
export function primeTabSound() {
  if (el || typeof Audio === "undefined") return;
  try {
    el = new Audio(TAB);
    el.preload = "auto";
    // Loud enough to be part of the press, quiet enough to live under a
    // conversation: this fires on the control used more than any other.
    el.volume = 0.45;
  } catch {
    el = null;
  }
}

/** The blip a tab makes. Silent, never throwing, if anything is unavailable. */
export function playTabSound() {
  primeTabSound();
  if (!el) return;
  try {
    el.currentTime = 0;
    void el.play().catch(() => {});
  } catch {
    // An element that is still loading rejects currentTime. The next press
    // will find it ready.
  }
}
