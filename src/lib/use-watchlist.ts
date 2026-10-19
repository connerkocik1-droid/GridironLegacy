"use client";

import { useSyncExternalStore } from "react";

/**
 * Who this manager is watching, shared by every place a star is drawn — the
 * Free Agency rows, the Watchlist and the player sheet — so starring a man in
 * one lights him up in the others without a reload.
 */

let watching = new Set<string>();
let started = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export async function reloadWatchlist() {
  try {
    const res = await fetch("/api/watchlist", { cache: "no-store" });
    if (!res.ok) return;
    const body = await res.json();
    watching = new Set<string>(body.players ?? []);
    emit();
  } catch {
    // A star nobody can draw is a star nobody has set.
  }
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!started) {
    started = true;
    void reloadWatchlist();
  }
  return () => {
    listeners.delete(fn);
  };
}

const EMPTY = new Set<string>();

export function useWatchlist(): Set<string> {
  return useSyncExternalStore(subscribe, () => watching, () => EMPTY);
}

/** Stars or unstars him: shown at once, and put back if the server says no. */
export async function toggleWatch(name: string) {
  const was = watching.has(name);
  const next = new Set(watching);
  if (was) next.delete(name);
  else next.add(name);
  watching = next;
  emit();
  try {
    const res = was
      ? await fetch(`/api/watchlist?player=${encodeURIComponent(name)}`, { method: "DELETE" })
      : await fetch("/api/watchlist", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ player: name }),
        });
    if (!res.ok) throw new Error(String(res.status));
  } catch {
    await reloadWatchlist();
  }
}
