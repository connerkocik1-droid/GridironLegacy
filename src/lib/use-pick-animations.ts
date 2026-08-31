"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether this browser plays the full-screen reveal when a pick lands.
 *
 * Deliberately kept in localStorage rather than on the manager's row. It is a
 * preference about this screen — somebody watching on a phone in a crowded
 * room, or on a laptop they are also working on — and switching it off must
 * not take the reveal away from the other eleven people. Nothing here touches
 * the league, and nothing here is sent anywhere.
 *
 * The chime is left alone either way: with the reveal off it becomes the only
 * signal that a pick has landed, which is exactly when it is most wanted.
 */
const KEY = "gl.pickAnimations";

let value: boolean | null = null;
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== "off";
  } catch {
    // Private browsing, or storage turned off. The animation is the default.
    return true;
  }
}

function snapshot(): boolean {
  if (value === null) value = read();
  return value;
}

/** True on the server, so the first paint matches the default. */
function serverSnapshot(): boolean {
  return true;
}

export function setPickAnimations(on: boolean) {
  value = on;
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // The choice still holds for this page; it just will not be remembered.
  }
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function usePickAnimations(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
