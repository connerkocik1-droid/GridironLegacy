"use client";

import { useSyncExternalStore } from "react";

/**
 * Which player's sheet is open, if any. One sheet for the whole app, mounted
 * in the layout: tapping a name on any screen calls openPlayer and the card
 * slides up over whatever is there. From the player sheet in
 * prototype/Pylon App.dc.html.
 */

let open: string | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function openPlayer(name: string) {
  open = name;
  emit();
}

export function closePlayer() {
  open = null;
  emit();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function useOpenPlayer(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => null,
  );
}
