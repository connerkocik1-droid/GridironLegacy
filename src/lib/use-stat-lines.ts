"use client";

import { useSyncExternalStore } from "react";

/**
 * Whether the matchup draws each player's stat line under his name.
 *
 * Off by default, and that default is what buys the page: eleven rows and a
 * scoreline fit one phone screen only while the lines are away. They are not
 * clipped to get there — a clipped line hides exactly the touchdown somebody
 * opened the page to read — they are hidden whole, behind one switch above
 * the rows, so a reader who wants them gets all of them.
 *
 * Per browser, like the folded sections on the home page: how much of a
 * matchup somebody wants on screen is a fact about their screen. Remembered
 * so the reader who prefers the long form is not asked again every week.
 *
 * The server snapshot says off, which is also the first paint, so nothing
 * flashes open and folds shut on arrival.
 */
const KEY = "gl.matchup.statLines";

let value: boolean | null = null;
const listeners = new Set<() => void>();

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === "on";
  } catch {
    // Private mode, or storage turned off. The default stands.
    return false;
  }
}

function snapshot(): boolean {
  if (value === null) value = read();
  return value;
}

/** Away, which is what the server renders. */
function serverSnapshot(): boolean {
  return false;
}

export function setStatLines(on: boolean) {
  value = on;
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // Not worth failing the press over; it just will not be remembered.
  }
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export function useStatLines(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}
