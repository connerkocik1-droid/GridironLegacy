"use client";

import { useSyncExternalStore } from "react";

/**
 * The league's crests, asked for once per page rather than once per row.
 *
 * The same shape as use-me: a small store behind useSyncExternalStore, so a
 * page with a crest beside every name on it still makes one request. Nothing
 * built on this should treat "not loaded yet" as "has no picture" — until the
 * answer arrives every franchise reads as empty, which is the same as a
 * franchise that has not uploaded one, and that is deliberately harmless.
 */
export type Logos = Record<string, string>;

let state: Logos = {};
let started = false;
const listeners = new Set<() => void>();

async function load() {
  try {
    const res = await fetch("/api/logos");
    if (!res.ok) return;
    const body = await res.json();
    state = body.logos ?? {};
    for (const listener of listeners) listener();
  } catch {
    // A crest is decoration. Failing to fetch one must never be visible as
    // anything other than the empty box that was there already.
  }
}

/** Re-reads the crests — call it after somebody changes theirs. */
export function refreshLogos() {
  return load();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  if (!started) {
    started = true;
    void load();
  }
  return () => {
    listeners.delete(onChange);
  };
}

const EMPTY: Logos = {};

export function useLogos(): Logos {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => EMPTY,
  );
}
