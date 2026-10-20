"use client";

import { useEffect, useSyncExternalStore } from "react";
import { seasonPlayers } from "./league-story";

/**
 * Where every scored player stands at his own position right now — "WR12" —
 * by this season's points across the league's whole pool, not across one
 * roster. One read of /api/rankings shared by every row and sheet on screen,
 * re-read when it is more than a few minutes old.
 */

const STALE_MS = 5 * 60_000;

let ranks: ReadonlyMap<string, string> = new Map();
let readAt = 0;
let inflight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function load() {
  if (inflight || Date.now() - readAt < STALE_MS) return;
  inflight = fetch("/api/rankings", { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((body) => {
      if (!body?.points) return;
      const next = new Map<string, string>();
      const count = new Map<string, number>();
      // seasonPlayers hands them back most points first.
      for (const p of seasonPlayers(body.points, body.rostered ?? {})) {
        if (!p.pos) continue;
        const n = (count.get(p.pos) ?? 0) + 1;
        count.set(p.pos, n);
        next.set(p.name, `${p.pos}${n}`);
      }
      ranks = next;
      readAt = Date.now();
      for (const l of listeners) l();
    })
    .catch(() => {})
    .finally(() => {
      inflight = null;
    });
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

const EMPTY: ReadonlyMap<string, string> = new Map();

export function usePositionRanks(): ReadonlyMap<string, string> {
  useEffect(load, []);
  return useSyncExternalStore(
    subscribe,
    () => ranks,
    () => EMPTY,
  );
}
